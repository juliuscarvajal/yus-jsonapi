/* jshint node: true */
/* jshint esnext: true */

var _ = require('lodash');


var baseUrl = '';
function setBaseUrl(a) {
  baseUrl = a;
}
function getBaseUrl() {
  // return 'todo-get-base-url';
  // return 'http://localhost:3000/api/v0';
  return baseUrl;
}

function getResourceIdentifierObjects(models) {
  return _.map(models, getResourceIdentifierObject);
}

function getResourceObjects(models) {
  return _.map(models, getResourceObject);
}

function getResourceObject(model) {
  var resourceObject        = getResourceIdentifierObject(model);
  resourceObject.attributes = getAttributesObject(model);
  resourceObject.links      = getResourceLinksObject(model)
  if(hasRelationships(model)) {
    resourceObject.relationships = getRelationshipsObject(model);
  }
  return resourceObject;
}

function hasRelationships(model)
{
  return _.keys(model.relationships).length;
}

function isRelationshipsEndpoint(req)
{
  return _.contains(req.originalUrl, '/relationships/');
}


// http://jsonapi.org/format/#document-resource-identifier-objects
function getResourceIdentifierObject(model) {
  return {
    type: model.constructor.type + 's', //TODO: temporary fix as angular-jsonapi library is not happy with singular types.  https://github.com/jakubrohleder/angular-jsonapi/issues/28
    id: model.attributes.id
  }
};

// http://jsonapi.org/format/#document-resource-object-relationships
function getRelationshipLinksObject(model, relationshipName)
{
  return {
    self: getBaseUrl() + '/' + model.constructor.api + '/' + model.attributes.id + '/relationships/' + relationshipName,
    related: getBaseUrl() + '/' + model.constructor.api + '/' + model.attributes.id + '/' + relationshipName //TODO: get model from each model.relationship...
  };
}

// http://jsonapi.org/format/#document-resource-objects
function getResourceLinksObject(model)
{
  var links = {
    collection: getBaseUrl() + '/' + model.constructor.api,
    self: getBaseUrl() + '/' + model.constructor.api + '/' + model.attributes.id
  };
  
  if(!_.isEmpty(model.links)) 
  {
    _.map(model.links, function(getLinkFunction, linkName) {
      links[linkName] = getLinkFunction(model);
    });
  }
  
  return links;
}

function getAttributesObject(model) {
  return _.omit(model.toJSON({shallow: true}), 'id');
}

function relationshipIsToOne(relationship)
{
  var one2one = ['belongsTo', 'hasOne', 'morphOne'];
  var isOne2one = _.indexOf(one2one, relationship.relatedData.type) > -1;
  return isOne2one;
}

function getRelationshipsObject(model) {
  var relationshipsObject = {};
  
  _.forEach(model.relationships, function(relationship, relationshipName) {
    
    relationshipsObject[relationshipName] = {};
    relationshipsObject[relationshipName]['links'] = getRelationshipLinksObject(model, relationshipName);
    
    // all relationships are defined in model.relationships (these are just the functions like return this.hasMany, etc.)
    // included relationships are defined in model.relations (these are collections, like result sets)
    if(model.relations[relationshipName])
    {
      if(relationshipIsToOne(model.relations[relationshipName]))
      {
        relationshipsObject[relationshipName]['data'] = getResourceIdentifierObject(model.relations[relationshipName]);
      }
      else
      {
        relationshipsObject[relationshipName]['data'] = getResourceIdentifierObjects(model.relations[relationshipName].models);
      }
    }
  });
  
  return relationshipsObject;
};


function gatherIncludesForEach(models, includes)
{
  _.forEach(models, function(model) {
    includes = gatherIncludes(model, includes);
  });
  
  return includes;
}

function gatherIncludes(model, includes)
{
  // Get the resource object
  var resourceObject = getResourceObject(model);
  
  // If we've already added it, don't add it (or gather it's includes) again
  var existing = _.find(includes, function(existingResource){
    return (existingResource.id == resourceObject.id && existingResource.type == resourceObject.type);
  });
  if(existing) return includes; // If this model is already in the includes, skip it.
  
  // Otherwise, add it
  includes.push(resourceObject);
  
  // And gather it's includes (note that this is recursive)
  _.forEach(model.relations, function(relationship, relationshipName){
    if(relationshipIsToOne(relationship))
    {
      includes = gatherIncludes(relationship.model, includes);
    }
    else
    {
      gatherIncludesForEach(relationship.models, includes);
    }
  });
  
  return includes;
}

function omitPrimaryFromIncludes(primaryData, includes)
{
  var newIncludes = [];
  
  if(!_.isArray(primaryData)) primaryData = [primaryData];
  
  _.forEach(includes, function(includedResource, index){
    
    var existing = _.find(primaryData, function(primaryDataResource){
      return (primaryDataResource.id == includedResource.id && primaryDataResource.type == includedResource.type);
    });
    if(!existing) newIncludes.push(includedResource);
    
  });
  
  return newIncludes;
}












/**
 * JSONAPIify a bookshelf model.
 * Requires:
 * 
 * - Model.type (Defined on each model)
 * - res.data (Bookshelf model)
 *
 * @param {[[Type]]} req  [[Description]]
 * @param {[[Type]]} res  [[Description]]
 * @param {[[Type]]} next [[Description]]
 */
function toJSONAPI(req, res, next) {
  var model = res.data; //The bookshelf model
  setBaseUrl(req.protocol + '://' + req.get('Host') + req.baseUrl); // todo: rm this hax
  
  // putting ?raw=true will cause the response w/o any toJSONAPIifying happening
  if (req.query.raw) {
    res.json(model.toJSON());
  }
  
  // Primary Data object
  /*
   * http://jsonapi.org/format/#document-top-level
   * Primary data MUST be either:
   * 
   * - a single resource object, a single resource identifier object, or null, for requests that target single resources
   * - an array of resource objects, an array of resource identifier objects, or an empty array ([]), for requests that target resource collections
   */
  var primaryData = null;
  var includes = [];
  if(model.models) // There's multiple resources in the result listing. eg /channels, /channels/4/schedules, /channels/4/relationships/schedules
  {
    if(isRelationshipsEndpoint(req))
    {
      primaryData = getResourceIdentifierObjects(model.models);
    }
    else
    {
      primaryData = getResourceObjects(model.models);
      includes = gatherIncludesForEach(model.models, includes);
    }
  }
  else // there's only one resource in the result listing. eg /channels/4, /locations/5/timezone, channels/4?include=schedules
  {
    if(isRelationshipsEndpoint(req))
    {
      primaryData = getResourceIdentifierObject(model);
    }
    else
    {
      primaryData = getResourceObject(model);
      includes = gatherIncludes(model, includes);
    }
  }
  
  includes = omitPrimaryFromIncludes(primaryData, includes);
  
  // Top-level document
  // http://jsonapi.org/format/#document-top-level
  var topLevelDocument = {};
  topLevelDocument.data = primaryData;
  if(req.query.include) {
    topLevelDocument.included = includes;
  }
  topLevelDocument.links = {self: getBaseUrl() + req.url};
  
  
  // Modify Response object & call next function
  res.jsonapi = topLevelDocument;
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
