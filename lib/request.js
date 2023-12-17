/*!
 * request.js - http request for brq
 * Copyright (c) 2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/brq
 */

'use strict';

const assert = require('bsert');
const {Stream} = require('stream');
const mime = require('./mime');

/*
 * Lazily Loaded
 */

let URL = null;
let qs = null;
let http = null;
let https = null;
let StringDecoder = null;

/**
 * RequestOptions
 */

class RequestOptions {
  /**
   * Request Options
   * @constructor
   * @ignore
   * @param {Object} options
   */

  constructor(options, buffer) {
    ensureRequires();

    this.method = 'GET';
    this.url = new URL('http://localhost');
    this.strictSSL = true;
    this.pool = false;
    this.agent = null;
    this.lookup = null;

    this.type = null;
    this.expect = null;
    this.body = null;
    this.username = '';
    this.password = '';
    this.limit = 20 << 20;
    this.maxRedirects = 5;
    this.timeout = 5000;
    this.buffer = buffer || false;
    this.headers = Object.create(null);
    this.ca = null;

    if (options != null)
      this.fromOptions(options);
  }

  fromOptions(options) {
    if (options instanceof URL)
      options = options.toString();

    if (typeof options === 'string')
      options = { url: options };

    assert(options && typeof options === 'object');

    if (options.method != null) {
      assert(typeof options.method === 'string');
      this.method = options.method.toUpperCase();
    }

    if (options.uri != null)
      this.navigate(options.uri);

    if (options.url != null)
      this.navigate(options.url);

    if (options.ssl != null) {
      assert(typeof options.ssl === 'boolean');
      if (options.ssl)
        this.url.protocol = 'https:';
      else
        this.url.protocol = 'http:';
    }

    if (options.host != null) {
      assert(typeof options.host === 'string');
      if (options.host.indexOf(':') !== -1)
        this.url.hostname = `[${options.host}]`;
      else
        this.url.hostname = options.host;
    }

    if (options.port != null) {
      assert((options.port & 0xffff) === options.port);
      assert(options.port !== 0);
      this.url.port = String(options.port);
    }

    if (options.path != null) {
      assert(typeof options.path === 'string');
      this.url.pathname = options.path;
    }

    if (options.query != null) {
      if (typeof options.query === 'string') {
        this.url.search = prepend(options.query);
      } else {
        assert(typeof options.query === 'object');
        this.url.search = prepend(qs.stringify(options.query));
      }
    }

    if (options.username != null) {
      assert(typeof options.username === 'string');
      this.username = options.username;
    }

    if (options.password != null) {
      assert(typeof options.password === 'string');
      this.password = options.password;
    }

    if (options.strictSSL != null) {
      assert(typeof options.strictSSL === 'boolean');
      this.strictSSL = options.strictSSL;
    }

    if (options.pool != null) {
      assert(typeof options.pool === 'boolean');
      this.pool = options.pool;
    }

    if (options.agent != null) {
      assert(typeof options.agent === 'string');
      this.agent = options.agent;
    }

    if (options.json != null) {
      assert(typeof options.json === 'object');
      this.body = JSON.stringify(options.json);
      this.type = 'json';
    }

    if (options.form != null) {
      assert(typeof options.form === 'object');
      this.body = qs.stringify(options.form);
      this.type = 'form';
    }

    if (options.type != null) {
      assert(typeof options.type === 'string');
      this.type = options.type;
    }

    if (options.expect != null) {
      assert(typeof options.expect === 'string');
      this.expect = options.expect;
    }

    if (options.body != null) {
      if (typeof options.body === 'string') {
        this.body = options.body;
      } else {
        assert(Buffer.isBuffer(options.body));
        this.body = options.body;
      }
    }

    if (options.timeout != null) {
      assert(typeof options.timeout === 'number');
      this.timeout = options.timeout;
    }

    if (options.limit != null) {
      assert(typeof options.limit === 'number');
      this.limit = options.limit;
    }

    if (options.maxRedirects != null) {
      assert(typeof options.maxRedirects === 'number');
      this.maxRedirects = options.maxRedirects;
    }

    if (options.headers != null) {
      assert(typeof options.headers === 'object');
      this.headers = options.headers;
    }

    if (options.lookup != null) {
      assert(typeof options.lookup === 'function');
      this.lookup = options.lookup;
    }

    if (options.ca != null) {
      assert(Buffer.isBuffer(options.ca));
      this.ca = options.ca;
    }

    return this;
  }

  navigate(url) {
    if (url instanceof URL)
      url = url.toString();

    assert(typeof url === 'string');

    this._navigate(new URL(url));
  }

  _navigate(url) {
    this.url = url;

    if (this.url.protocol !== 'http:' &&
        this.url.protocol !== 'https:') {
      throw new Error('Invalid URL protocol.');
    }

    if (this.url.port === '0')
      throw new Error('Invalid URL port.');

    this.username = this.url.username;
    this.password = this.url.password;

    this.url.username = '';
    this.url.password = '';
    this.url.hash = '';
  }

  isExpected(type) {
    assert(typeof type === 'string');

    if (!this.expect)
      return true;

    return this.expect === type;
  }

  isOverflow(hdr) {
    if (hdr == null)
      return false;

    assert(typeof hdr === 'string');

    if (!this.buffer)
      return false;

    hdr = hdr.trim();

    if (!/^\d+$/.test(hdr))
      return false;

    hdr = hdr.replace(/^0+/g, '');

    if (hdr.length === 0)
      hdr = '0';

    if (hdr.length > 15)
      return false;

    const length = parseInt(hdr, 10);

    if (!Number.isSafeInteger(length))
      return true;

    return length > this.limit;
  }

  getBackend() {
    const ssl = this.url.protocol === 'https:';
    ensureRequires(ssl);
    return ssl ? https : http;
  }

  getHeaders() {
    const headers = Object.create(null);

    if (this.agent != null)
      headers['User-Agent'] = this.agent;

    if (this.type)
      headers['Content-Type'] = mime.type(this.type);

    if (this.body != null && this.buffer) {
      if (typeof this.body === 'string') {
        const length = Buffer.byteLength(this.body, 'utf8');
        headers['Content-Length'] = length.toString(10);
      } else {
        headers['Content-Length'] = this.body.length.toString(10);
      }
    }

    if (this.username || this.password) {
      const auth = `${this.username}:${this.password}`;
      const data = Buffer.from(auth, 'utf8');
      headers['Authorization'] = `Basic ${data.toString('base64')}`;
    }

    Object.assign(headers, this.headers);

    return headers;
  }

  redirect(location) {
    this._navigate(new URL(location, this.url));
  }

  toHTTP() {
    const defaultPort = this.url.protocol === 'https:' ? 443 : 80;
    const hostname = this.url.hostname;
    const isV6 = hostname[0] === '[';

    return {
      method: this.method,
      host: isV6 ? hostname.slice(1, -1) : hostname,
      port: Number(this.url.port || defaultPort),
      path: (this.url.pathname || '/') + this.url.search,
      headers: this.getHeaders(),
      agent: this.pool ? null : false,
      lookup: this.lookup || undefined,
      rejectUnauthorized: this.strictSSL,
      ca: this.ca || undefined
    };
  }
}

/**
 * Request
 */

class Request extends Stream {
  /**
   * Request
   * @constructor
   * @param {Object} options
   */

  constructor(options, buffer) {
    super();

    this.options = new RequestOptions(options, buffer);
    this.req = null;
    this.res = null;
    this.statusCode = 0;
    this.headers = Object.create(null);
    this.type = 'bin';
    this.redirects = 0;
    this.timeout = null;
    this.finished = false;
    this.hasData = false;

    this.onResponse = this.handleResponse.bind(this);
    this.onData = this.handleData.bind(this);
    this.onEnd = this.handleEnd.bind(this);
    this.onError = this.handleError.bind(this);

    this.total = 0;
    this.decoder = null;
    this.buf = [];
    this.str = '';
  }

  startTimeout() {
    if (!this.options.timeout)
      return;

    if (this.timeout != null)
      return;

    this.timeout = setTimeout(() => {
      this.timeout = null;
      this.finish(new Error('Request timed out.'));
    }, this.options.timeout);
  }

  stopTimeout() {
    if (this.timeout != null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  cleanup() {
    this.stopTimeout();

    if (this.req) {
      this.req.removeListener('response', this.onResponse);
      this.req.removeListener('error', this.onError);
      this.req.addListener('error', () => {});
    }

    if (this.res) {
      this.res.removeListener('data', this.onData);
      this.res.removeListener('error', this.onError);
      this.res.removeListener('end', this.onEnd);
      this.res.addListener('error', () => {});
    }
  }

  close() {
    this.cleanup();

    if (this.req) {
      try {
        this.req.abort();
      } catch (e) {
        ;
      }
    }

    if (this.res) {
      try {
        this.res.destroy();
      } catch (e) {
        ;
      }
    }

    this.req = null;
    this.res = null;
  }

  destroy() {
    this.close();
  }

  start() {
    const http = this.options.getBackend();
    const options = this.options.toHTTP();

    this.req = http.request(options);
    this.res = null;

    this.req.on('response', this.onResponse);
    this.req.on('error', this.onError);

    if (this.options.body != null) {
      if (typeof this.options.body === 'string')
        this.req.write(this.options.body, 'utf8');
      else
        this.req.write(this.options.body);
    }
  }

  setEncoding(enc) {
    assert(!this.options.buffer);
    assert(!this.res);
    this.decoder = new StringDecoder(enc);
    return this;
  }

  write(...args) {
    if (args.length > 0 && args[0])
      this.hasData = true;

    return this.req.write(...args);
  }

  end(...args) {
    if (args.length > 0 && args[0])
      this.hasData = true;

    this.startTimeout();

    return this.req.end(...args);
  }

  finish(err) {
    if (this.finished)
      return;

    this.finished = true;

    if (err) {
      this.destroy();
      this.emit('error', err);
      return;
    }

    this.cleanup();
    this.emit('end');
    this.emit('close');
  }

  handleResponse(res) {
    const {headers} = res;
    const location = headers['location'];

    if (location) {
      if (this.redirects >= this.options.maxRedirects) {
        this.finish(new Error('Too many redirects.'));
        return;
      }

      if (!this.options.buffer && this.hasData) {
        this.finish(new Error('Cannot rewrite body for redirect.'));
        return;
      }

      this.redirects += 1;
      this.close();

      try {
        this.options.redirect(location);
      } catch (e) {
        this.finish(e);
        return;
      }

      this.start();
      this.end();

      return;
    }

    const type = mime.ext(headers['content-type']);

    if (!this.options.isExpected(type)) {
      this.finish(new Error('Wrong content-type for response.'));
      return;
    }

    const length = headers['content-length'];

    if (this.options.isOverflow(length)) {
      this.finish(new Error('Response exceeded limit.'));
      return;
    }

    this.res = res;
    this.statusCode = res.statusCode;
    this.headers = headers;
    this.type = type;

    this.res.on('data', this.onData);
    this.res.on('error', this.onError);
    this.res.on('end', this.onEnd);

    this.emit('headers', headers);
    this.emit('type', type);
    this.emit('response', res);

    if (this.options.buffer) {
      if (mime.textual(this.type)) {
        this.decoder = new StringDecoder('utf8');
        this.str = '';
      } else {
        this.buf = [];
      }
    }
  }

  handleData(data) {
    this.total += data.length;

    if (this.options.buffer) {
      if (this.options.limit && this.total > this.options.limit) {
        this.finish(new Error('Response exceeded limit.'));
        return;
      }

      if (this.decoder)
        this.str += this.decoder.write(data);
      else
        this.buf.push(data);
    } else {
      if (this.decoder) {
        const chunk = this.decoder.write(data);

        if (chunk.length > 0)
          this.emit('data', chunk);
      } else {
        this.emit('data', data);
      }
    }
  }

  handleEnd() {
    if (this.decoder) {
      const chunk = this.decoder.end();

      if (this.options.buffer)
        this.str += chunk;
      else if (chunk.length > 0)
        this.emit('data', chunk);
    }

    this.finish(null);
  }

  handleError(err) {
    this.finish(err);
  }

  text() {
    if (this.decoder)
      return this.str;
    return this.buffer().toString('utf8');
  }

  buffer() {
    if (this.decoder)
      return Buffer.from(this.str, 'utf8');
    return Buffer.concat(this.buf);
  }

  json() {
    const text = this.text().trim();

    if (text.length === 0)
      return Object.create(null);

    const body = JSON.parse(text);

    if (!body || typeof body !== 'object')
      throw new Error('JSON body is a non-object.');

    return body;
  }

  form() {
    return qs.parse(this.text());
  }
}

/**
 * Make an HTTP request.
 * @param {Object} options
 * @returns {Promise}
 */

function request(options) {
  return new Promise((resolve, reject) => {
    let req;

    try {
      req = new Request(options, true);
    } catch (e) {
      reject(e);
      return;
    }

    req.on('error', err => reject(err));
    req.on('end', () => resolve(req));

    try {
      req.start();
      req.end();
    } catch (e) {
      req.destroy();
      reject(e);
    }
  });
}

request.stream = function stream(options) {
  const req = new Request(options, false);
  req.start();
  return req;
};

/*
 * Helpers
 */

function ensureRequires(ssl) {
  if (!URL)
    URL = global.URL || require('url').URL;

  if (!qs)
    qs = require('querystring');

  if (!http)
    http = require('http');

  if (ssl && !https)
    https = require('https');

  if (!StringDecoder)
    StringDecoder = require('string_decoder').StringDecoder;
}

function prepend(qs) {
  return qs ? '?' + qs : '';
}

/*
 * Expose
 */

exports.request = request;
