'use strict';

const UglifyJsPlugin = require('uglifyjs-webpack-plugin');

module.exports = {
  target: 'web',
  entry: {
    'breq': './lib/breq'
  },
  output: {
    library: 'breq',
    libraryTarget: 'umd',
    path: __dirname,
    filename: '[name].js'
  },
  resolve: {
    modules: ['node_modules'],
    extensions: ['-browser.js', '.js', '.json']
  },
  module: {
    rules: [{
      test: /\.js$/,
      loader: 'babel-loader'
    }]
  },
  plugins: [
    new UglifyJsPlugin()
  ]
};
