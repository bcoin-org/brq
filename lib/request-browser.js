/*!
 * request.js - http request for brq
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/brq
 */

'use strict';

const assert = require('bsert');
const EventEmitter = require('events');
const mime = require('./mime');
const {fetch, Headers, URL, URLSearchParams} = global;

/**
 * Request Options
 */

class RequestOptions {
  /**
   * Request Options
   * @constructor
   * @ignore
   * @param {Object} options
   */

  constructor(options, buffer) {
    if (typeof fetch !== 'function')
      throw new Error('Fetch API not available.');

    this.method = 'GET';
    this.url = new URL('http://localhost');
    this.agent = null;

    this.type = null;
    this.expect = null;
    this.body = null;
    this.username = '';
    this.password = '';
    this.limit = 20 << 20;
    this.timeout = 5000;
    this.buffer = buffer || false;
    this.headers = Object.create(null);

    if (options != null)
      this.fromOptions(options);
  }

  fromOptions(options) {
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
      this.url.protocol = 'https:';
    }

    if (options.host != null) {
      assert(typeof options.host === 'string');
      if (options.host.indexOf('::') !== -1)
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
        this.url.search = prepend(encodeSearch(options.query));
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
      this.body = encodeSearch(options.form);
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

    if (options.headers != null) {
      assert(typeof options.headers === 'object');
      this.headers = options.headers;
    }

    return this;
  }

  addChunks(chunks) {
    if (this.body == null) {
      this.body = Buffer.concat(chunks);
    } else {
      if (typeof this.body === 'string')
        this.body = Buffer.from(this.body, 'utf8');

      this.body = Buffer.concat([this.body, ...chunks]);
    }
  }

  navigate(url) {
    assert(typeof url === 'string');

    if (url.indexOf('://') === -1)
      url = 'http://' + url;

    this.url = new URL(url);
    this.username = this.url.username;
    this.password = this.url.password;

    this.url.username = '';
    this.url.password = '';
    this.url.hash = '';

    return this;
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

  getHeaders() {
    const headers = new Headers();

    let referrer = null;

    // https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name
    if (this.agent != null)
      headers.append('User-Agent', this.agent);

    if (this.type)
      headers.append('Content-Type', mime.type(this.type));

    if (this.username || this.password) {
      const auth = `${this.username}:${this.password}`;
      const data = Buffer.from(auth, 'utf8');
      headers.append('Authorization', `Basic ${data.toString('base64')}`);
    }

    for (const name of Object.keys(this.headers)) {
      const value = String(this.headers[name]);

      switch (name.toLowerCase()) {
        case 'referer':
        case 'referrer':
          referrer = value;
          continue;
      }

      headers.append(name, value);
    }

    return [headers, referrer];
  }

  toURL() {
    return this.url.toString();
  }

  toHTTP() {
    // https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#parameters
    // https://developer.mozilla.org/en-US/docs/Web/API/Request/mode
    // https://developer.mozilla.org/en-US/docs/Web/API/Request/credentials
    const auth = this.username || this.password;
    const [headers, referrer] = this.getHeaders();

    const options = {
      method: this.method,
      headers,
      mode: 'cors',
      credentials: auth ? 'include' : 'omit',
      cache: 'no-store',
      redirect: 'follow'
    };

    if (this.body != null) {
      if (Buffer.isBuffer(this.body)) {
        options.body = new Uint8Array(this.body.buffer,
                                      this.body.byteOffset,
                                      this.body.byteLength);
      } else {
        options.body = this.body;
      }
    }

    if (referrer != null)
      options.referrer = referrer;

    return options;
  }
}

/**
 * Response
 */

class Response {
  /**
   * Response
   * @constructor
   */

  constructor() {
    this.statusCode = 0;
    this.headers = Object.create(null);
    this.type = 'bin';
    this.str = '';
    this.buf = null;
  }

  text() {
    if (!this.buf)
      return this.str;
    return this.buf.toString('utf8');
  }

  buffer() {
    if (!this.buf)
      return Buffer.from(this.str, 'utf8');
    return this.buf;
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
    return decodeSearch(this.text());
  }

  static fromFetch(response) {
    const res = new Response();

    res.statusCode = response.status;

    for (const [key, value] of response.headers.entries())
      res.headers[key.toLowerCase()] = value;

    return res;
  }
}

/**
 * Make an HTTP request.
 * @private
 * @param {Object} options
 * @returns {Promise}
 */

async function _request(options) {
  const response = await fetch(options.toURL(), options.toHTTP());
  const res = Response.fromFetch(response);
  const type = mime.ext(res.headers['content-type']);
  const length = res.headers['content-length'];

  if (!options.isExpected(type))
    throw new Error('Wrong content-type for response.');

  if (options.isOverflow(length))
    throw new Error('Response exceeded limit.');

  res.type = type;

  if (mime.textual(type)) {
    const data = await response.text();

    if (options.limit && data.length > options.limit)
      throw new Error('Response exceeded limit.');

    res.str = data;
  } else {
    const data = await response.arrayBuffer();

    if (options.limit && data.byteLength > options.limit)
      throw new Error('Response exceeded limit.');

    res.buf = Buffer.from(data, 0, data.byteLength);
  }

  return res;
}

/**
 * Make an HTTP request.
 * @param {Object} options
 * @returns {Promise}
 */

async function request(options) {
  return _request(new RequestOptions(options, true));
}

request.stream = function stream(options) {
  const opt = new RequestOptions(options, false);
  const st = new EventEmitter();
  const chunks = [];

  let encoding = null;
  let closed = false;

  // @ts-ignore
  st.close = () => {
    if (!closed) {
      closed = true;
      st.emit('close');
    }
    return st;
  };

  st.destroy = st.close;

  // @ts-ignore
  st.setEncoding = (enc) => {
    encoding = enc;
    return st;
  };

  // @ts-ignore
  st.write = (data, enc) => {
    if (closed)
      return false;

    if (!Buffer.isBuffer(data)) {
      assert(typeof data === 'string');
      data = Buffer.from(data, enc || 'utf8');
    }

    chunks.push(data);

    return true;
  };

  // @ts-ignore
  st.end = (data, enc) => {
    if (closed)
      return false;

    if (data)
      st.write(data, enc);

    if (chunks.length > 0) {
      opt.addChunks(chunks);
      chunks.length = 0;
    }

    _request(opt).then((res) => {
      let data;

      if (closed)
        return;

      if (encoding === 'utf8')
        data = res.text();
      else if (typeof encoding === 'string')
        data = res.buffer().toString(encoding);
      else
        data = res.buffer();

      st.emit('headers', res.headers);
      st.emit('type', res.type);
      st.emit('response', res);
      st.emit('data', data);
      st.emit('end');
      st.close();
    }).catch((err) => {
      if (closed)
        return;
      st.emit('error', err);
    });

    return true;
  };

  return st;
};

/*
 * Helpers
 */

function appendSearch(search, key, value) {
  if (Array.isArray(value)) {
    for (const item of value)
      appendSearch(search, key, item);
  } else if (typeof value === 'string') {
    search.append(key, value);
  } else if (typeof value === 'number' ||
             typeof value === 'bigint') {
    search.append(key, String(value));
  } else {
    search.append(key, '');
  }
}

function encodeSearch(data) {
  const search = new URLSearchParams();

  for (const key of Object.keys(data))
    appendSearch(search, key, data[key]);

  return search.toString();
}

function decodeSearch(text) {
  const search = new URLSearchParams(text);
  const body = Object.create(null);

  for (const [key, value] of search.entries()) {
    if (Array.isArray(body[key])) {
      body[key].push(value);
    } else if (body[key] != null) {
      body[key] = [body[key], value];
    } else {
      body[key] = value;
    }
  }

  return body;
}

function prepend(qs) {
  return qs ? '?' + qs : '';
}

/*
 * Expose
 */

exports.request = request;
