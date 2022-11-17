const path = require('path');
const webpack = require('webpack');
const NodePolyfillPlugin = require("node-polyfill-webpack-plugin");


module.exports = {
  entry: "./src/index.ts",
  mode: 'production',
  target: "node",

  output: {
    filename: "./[name].js",
    path: path.resolve(__dirname, 'dist'),
    clean: true,
    // libraryTarget: 'commonjs2'
    libraryTarget: 'commonjs'
  },
  plugins: [
    new NodePolyfillPlugin(),
  ],

    externals: [
    {
      'aws-sdk': {
        root: 'aws-sdk',
        commonjs2: 'aws-sdk',
        commonjs: 'aws-sdk',
        amd: 'aws-sdk'
      }
    }
  ],

  resolve: {
    // Add '.ts' and '.tsx' as resolvable extensions.
    extensions: ["", ".webpack.js", ".web.js", ".ts", ".tsx", ".js"],
  },

  module: {
    rules: [
      // All files with a '.ts' or '.tsx' extension will be handled by 'ts-loader'.
      {
        test: /\.tsx?$/,
        loader: "ts-loader",
        exclude: /node_modules/,
      },

    ],
  },
};