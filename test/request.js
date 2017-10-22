'use strict';

const request = require('../');

(async () => {
  const res = await request('icanhazip.com');
  console.log(res.text());
})();
