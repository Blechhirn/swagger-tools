/*
 * Copyright 2014 Apigee Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var _ = require('lodash');
var expressStylePath = require('../helpers').expressStylePath;
var parseurl = require('parseurl');
var pathToRegexp = require('path-to-regexp');

/**
 * Middleware for providing Swagger information to downstream middleware and request handlers.  'req.swagger' will be
 * added to the request of all routes that match routes defined in your Swagger resources.  Here is the structure of
 * 'req.swagger':
 *
 *   * path: The Swagger path the request is associated with
 *   * operation: The Swagger path operation the request is associated with
 *   * params: The parameters for the request
 *     * schema: The resource API operation parameter definition
 *     * value: The value of the paramter from the request (Not converted to any particular type)
 *   * swaggerObject: The Swagger object itself
 *
 * This middleware requires that you use the appropriate middleware to populate req.body and req.query before this
 * middleware.  This middleware also makes no attempt to work around invalid Swagger documents.
 *
 * @param {object} swaggerObject - The Swagger object
 *
 * @returns the middleware function
 */
exports = module.exports = function swaggerMetadataMiddleware (swaggerObject) {
  if (_.isUndefined(swaggerObject)) {
    throw new Error('swaggerObject is required');
  } else if (!_.isPlainObject(swaggerObject)) {
    throw new TypeError('swaggerObject must be an object');
  }

  var paths = {};

  // Gather the paths, their path regex patterns and the corresponding operations
  _.each(swaggerObject.paths, function (path, pathName) {
    var keys = [];
    var re = pathToRegexp(expressStylePath(swaggerObject.basePath, pathName), keys);
    var reStr = re.toString();

    paths[reStr] = {
      path: path,
      keys: keys,
      re: re,
      operations: {}
    };

    _.each(['get', 'put', 'post', 'delete', 'options', 'head', 'patch'], function (method) {
      var operation = path[method];

      if (!_.isUndefined(operation)) {
        paths[reStr].operations[method] = operation;
      }
    });
  });

  return function swaggerMetadata (req, res, next) {
    var rPath = parseurl(req).pathname;
    var match;
    var path = _.find(paths, function (path) {
      match = path.re.exec(rPath);
      return _.isArray(match);
    });
    var metadata = {
      path: path ? path.path : undefined,
      operation: path ? path.operations[req.method.toLowerCase()] : undefined,
      params: {},
      swaggerObject: swaggerObject
    };

    // Collect the parameter values
    if (!_.isUndefined(metadata.operation)) {
      try {
        // Until Swagger 2.0 documentation comes out, I'm going to assume that you cannot override "path" parameters
        // with operation parameters.  That's why we start with the path parameters first and then the operation
        // parameters.  (Note: "path" in this context is a path entry at #/paths in the Swagger Object)
        _.each(_.union(metadata.path.parameters, metadata.operation.parameters), function (param) {
          var paramType = param.in || 'query';
          var val;

          // Get the value to validate based on the operation parameter type
          switch (paramType) {
          case 'body':
          case 'formData':
            if (!req.body) {
              throw new Error('Server configuration error: req.body is not defined but is required');
            }

            val = req.body[param.name];

            break;
          case 'header':
            val = req.headers[param.name];

            break;
          case 'path':
            _.each(path.keys, function (key, index) {
              if (key.name === param.name) {
                val = match[index + 1];
              }
            });

            break;
          case 'query':
            if (!req.query) {
              throw new Error('Server configuration error: req.query is not defined but is required');
            }

            val = req.query[param.name];

            break;
          }

          // Use the default value when necessary
          if (_.isUndefined(val) && !_.isUndefined(param.schema) && !_.isUndefined(param.schema.default)) {
            val = param.schema.default;
          }

          metadata.params[param.name] = {
            schema: param,
            value: val
          };
        });

        // Attach Swagger metadata to the request
        req.swagger = metadata;
      } catch (err) {
        return next(err.message);
      }
    }

    return next();
  };
};
