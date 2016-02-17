###yus-jsonapi

A JSON API (jsonapi.org) Implementation that uses Bookshelfjs models.

## Installation
```
npm install yus-jsonapi
```

## Usage

# ES6
```
import {toJSON} from 'yus-jsonapi';
import {toJSONAPI} from 'yus-jsonapi';
import {response} from 'yus-jsonapi';
```

# ES5
```
var toJSON = require('yus-jsonapi');
var toJSONAPI = require('yus-jsonapi');
var response = require('yus-jsonapi');
```

# Use with other middlewares
```
app.use(toJSON); // Converts JSONAPI request body to Bookshelfjs model. Generates the req.data (TODO: Convert to Bookshelfjs model)

// Other middlewares

app.use(toJSONAPI) // Converts the Bookshelfjs model (res.data) provided from previous middlewares to a JSONAPI compliant response. Generates res.jsonapi.

app.use(response) // Sends the res.jsonapi object and sets the appropriate status code.
```

* Disclaimer: This is currently under heavy developement. Use at your own risk.
