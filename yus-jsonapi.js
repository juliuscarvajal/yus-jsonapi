/* jshint node: true */
/* jshint esnext: true */

var _ = require('lodash');
//import {log} from './logger';

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
  var model = res.data; //The bookshelf model

  if (req.query.raw) {
    res.json(model.toJSON());
  }

  var one2one = ['belongsTo', 'hasOne', 'morphOne'];

  /*
  log.debug('url:', req.baseUrl, req.url, '|', req.originalUrl);
  log.debug('query:', req.query);
  log.debug('relationship:', req.relationship);
  */

  //Bookshelfjs issue: belongsTo does not have the .model object.
  //var type = data.model ? data.model.type : data.constructor.type;
  //log.debug('type:', type);

  var root = req.protocol + '://' + req.get('Host');
  var url = _.first(req.url.split('?'));

  var jsonapi = {
    links: {
      self: root + req.baseUrl + req.url
    },
  };

  var resourceId = function(model) {
    return model.id ? {
      type: model.constructor.type + 's', //TODO: temporary fix as Kalpana's angular-jsonapi library is not happy with singular types.  https://github.com/jakubrohleder/angular-jsonapi/issues/28
      id: model.attributes.id
    } : null;
  };

  var links = function(relationshipName) {
    return function(model) {
      return {
        self: root + req.baseUrl + '/' + model.constructor.api + '/' + model.attributes.id + '/relationships/' + relationshipName,
        related: root + req.baseUrl + '/' + model.constructor.api + '/' + model.attributes.id + '/' + relationshipName //TODO: get model from each model.relationship...
      };
    };
  };

  var relationships = function(includeLinks) {
    return function(model) {
      var rels = {};

      //TODO: Fix missing relation when specifying only one include. Ex. /channels?include=schedules (no screens)
      var relations = req.query.include ? model.relations : model.relationships;

      _.map(relations, function(r, k) {
        var related = null;
        if (req.query.include) {
          var relatedModels = r.models || r;
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
          var isOne2one = _.indexOf(one2one, r.relatedData.type) > -1;

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

  var attributes = function() {
    return function(model) {
      //return _.omit(model.attributes, 'id');
      return _.omit(model.toJSON({shallow: true}), 'id');
      //return model.toJSON();
    };
  };

  var data = function(model, attributes, relationships) {
    var topLevel = null;
    if (!model) {
      return topLevel;
    }

    if (model.model) {
      topLevel = model.models;
    }
    else {
      topLevel = model;
    }

    //topLevel = _.isArray(topLevel) ? topLevel : [topLevel];

    function buildData(v, k) {
      var json = null;

      var resId = resourceId(v);
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
        var rels = relationships(v);
        if (!_.isEmpty(rels)) {
          json.relationships = rels;
        }
      }

      return json;
    };

    var jsondata = _.isArray(topLevel) ? _.map(topLevel, buildData) : buildData(topLevel);

    return jsondata;
  };

  var resourceLinkage = data;
  var primaryData = data;

  var d = primaryData(model,
               attributes(),
               relationships(true));

  if (model && model.relatedData) {
    var isOne2one = _.indexOf(one2one, model.relatedData.type) > -1;
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

  var result = {};

  function gatherer(model, result) {
    if (!model)
      return null;

    _.map(model.relations, function(r, k) {
      //log.debug('model.relations', r);
      var relatedModels = r.models;

      if (_.isEmpty(result[k])) {
        result[k] = [];
      }

      if (relatedModels) {
        _.map(relatedModels, function(rm) {
          var relatedData = data(rm, attributes(), relationships(false));
          if (relatedData) {
            Array.prototype.push.apply(result[k], relatedData);
          }

          gatherer(rm, result);
        });
      }
      // No related models so just act on the data itself...
      else {
        var relatedData = data(r, attributes(), relationships(false));
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
  }

  if (model && model.models) {
    _.map(model.models, m => {
      gatherer(m, result);
    });
  }
  else {
    gatherer(model, result);
  }

  var included = [];
  _.map(result, (res, k) => {
    res = _.uniq(res, 'id');
    _.map(res, r => {
      included.push(r);
    });
  });

  if (!_.isEmpty(included)) {
    jsonapi.included = _.uniq(included, i => JSON.stringify(_.pick(i, ['id', 'type'])));
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
  var data = res.jsonapi;

  //TODO: set fail codes...
  if (_.isEmpty(res.jsonapi)) {
    if (!_.isEmpty(res.data)) {
      data = res.data;
    }
    else {
      return next({message: 'No data'});
    }
  }
  else {
    if (res.data === undefined) {
      return next({message: 'No data'});
    }
  }

  var success = {
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
