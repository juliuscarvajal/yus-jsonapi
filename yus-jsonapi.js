/* jshint node: true */
/* jshint esnext: true */

import _  from 'lodash';
import {log} from './logger';

/**
 * JSONAPIfy a bookshelf model.
 * Requires:
 * Model.type (Defined on each model)
 * res.data (Bookshelf model)
 *
 * @param {[[Type]]} req  [[Description]]
 * @param {[[Type]]} res  [[Description]]
 * @param {[[Type]]} next [[Description]]
 */
function toJSONAPI(req, res, next) {
  let model = res.data; //The bookshelf model

  if (req.query.raw) {
    res.json(model.toJSON());
  }

  let one2one = ['belongsTo', 'hasOne', 'morphOne'];

  /*
  log.debug('url:', req.baseUrl, req.url, '|', req.originalUrl);
  log.debug('query:', req.query);
  log.debug('relationship:', req.relationship);
  */

  //Bookshelfjs issue: belongsTo does not have the .model object.
  //let type = data.model ? data.model.type : data.constructor.type;
  //log.debug('type:', type);

  let root = req.protocol + '://' + req.get('Host');
  let url = _.first(req.url.split('?'));

  let jsonapi = {
    links: {
      self: root + req.baseUrl + req.url
    },
  };

  let resourceId = (model) => {
    return model.id ? {
      type: model.constructor.type + 's', //TODO: temporary fix as Kalpana's angular-jsonapi library is not happy with singular types.  https://github.com/jakubrohleder/angular-jsonapi/issues/28
      id: model.id
    } : null;
  };

  let links = (relationshipName) => {
    return (model) => {
      return {
        self: root + req.baseUrl + '/' + model.constructor.api + '/' + model.id + '/relationships/' + relationshipName,
        related: root + req.baseUrl + '/' + model.constructor.api + '/' + model.id + '/' + relationshipName //TODO: get model from each model.relationship...
      };
    };
  }

  let relationships = (includeLinks) => {
    return (model) => {
      let rels = {};

      //TODO: Fix missing relation when specifying only one include. Ex. /channels?include=schedules (no screens)
      let relations = req.query.include ? model.relations : model.relationships;

      _.map(relations, (r, k) => {
        let related = null;
        if (req.query.include) {
          let relatedModels = r.models || r;
          related = resourceLinkage(relatedModels);
        }
        else {
          rels[k] = {}; // all relationships...
        }

        if (includeLinks) {
          if (_.isEmpty(rels[k])) {
            rels[k] = {};
          }

          rels[k].links = links(k)(model);
        }

        if (!_.isEmpty(related)) {
          if (_.isEmpty(rels[k])) {
            rels[k] = {};
          }

          //*
          let isOne2one = _.indexOf(one2one, r.relatedData.type) > -1;

          if (isOne2one && _.size(related) === 1) {
            related = _.first(related);
          }
          //*/

          rels[k].data = related;
        }
      });

      if (_.isEmpty(rels)) {
        rels = null;
      }

      return rels;
    };
  };

  let attributes = () => {
    return (model) => {
      //return _.omit(model.attributes, 'id');
      return _.omit(model.toJSON({shallow: true}), 'id');
      //return model.toJSON();
    };
  };

  let data = (model, attributes, relationships) => {
    let topLevel = null;
    if (!model) {
      return topLevel;
    }

    if (model.model) {
      topLevel = model.models;
    }
    else {
      topLevel = model;
    }

    topLevel = _.isArray(topLevel) ? topLevel : [topLevel];
    let jsondata = _.map(topLevel, (v, k) => {
      let json = null;

      let resId = resourceId(v);
      if (resId) {
        json = resId;
      }
      else {
        json = {};
      }

      // if relationships url then just return the resource ids...
      if (_.contains(req.originalUrl, '/relationships/')) {
        return json;
      }

      if (attributes) {
        json.attributes = attributes(v);
      }

      if (relationships) {
        let rels = relationships(v);
        if (!_.isEmpty(rels)) {
          json.relationships = rels;
        }
      }

      return json;
    });

    return jsondata;
  }

  let resourceLinkage = data;
  let primaryData = data;

  let d = primaryData(model,
               attributes(),
               relationships(true));

  if (model && model.relatedData) {
    let isOne2one = _.indexOf(one2one, model.relatedData.type) > -1;
    if (isOne2one && _.size(d) === 1) {
      d = _.first(d);
    }
  }

  if (['POST', 'PATCH', 'PUT'].indexOf(req.method) > -1 && _.size(d) === 1) {
    d = _.first(d);
  }

  if (d) {
    jsonapi.data = d;
  }

  let result = {};

  function gatherer(model, result) {
    if (!model)
      return null;

    _.map(model.relations, (r, k) => {
      //log.debug('model.relations', r);
      let relatedModels = r.models;

      if (_.isEmpty(result[k])) {
        result[k] = [];
      }

      if (relatedModels) {
        _.map(relatedModels, rm => {
          let relatedData = data(rm, attributes(), relationships(false));
          if (relatedData) {
            Array.prototype.push.apply(result[k], relatedData);
          }

          gatherer(rm, result);
        });
      }
      // No related models so just act on the data itself...
      else {
        let relatedData = data(r, attributes(), relationships(false));
        if (relatedData) {
          Array.prototype.push.apply(result[k], relatedData);

          /*
          if (_.size(result[k]) === 1) {
            result[k] = relatedData;
          }
          */
        }
      }
    });
  };

  if (model && model.models) {
    _.map(model.models, m => {
      gatherer(m, result);
    });
  }
  else {
    gatherer(model, result);
  }

  let included = [];
  _.map(result, (res, k) => {
    res = _.uniq(res, 'id');
    _.map(res, r => {
      included.push(r);
    });
  });

  if (!_.isEmpty(included)) {
    jsonapi.included = included; //result;
  }

  res.jsonapi = jsonapi;
  next();
}

function toJSON(req, res, next) {
  //log.debug('post.body', req.body);

  //TODO: Batch requests. For now assume single data sets for post and patch.
  if (['POST', 'PATCH', 'PUT'].indexOf(req.method) > -1 && !_.isEmpty(req.body.data)) {
    req.data = req.body.data; //TODO: relationships handling. At the moment, this does the trick for top level resources.
  }

  if (req.data) {
    req.data = req.data.attributes;
  }

  next();
}

function response(req, res, next) {
  let data = res.jsonapi;

  //TODO: set fail codes...
  if (_.isEmpty(res.jsonapi)) {
    if (!_.isEmpty(res.data)) {
      data = res.data;
    }
    else {
      return res.sendStatus(404); //no data...
    }
  }

  let success = {
    'GET' : 200,
    'POST' : 201,
    'PATCH' : 200,
    'PUT' : 200,
    'DELETE' : 204,
  };

  // http://jsonapi.org/format/#crud-updating-relationships
  if (_.contains(req.originalUrl, '/relationships/')) {
    success.POST = 200;
  }

  res
    .status(success[req.method])
    .set('Content-Type', 'application/vnd.api+json')
    .json(data);

  next();
}

module.exports.toJSON = toJSON;
module.exports.toJSONAPI = toJSONAPI;
module.exports.response = response;
