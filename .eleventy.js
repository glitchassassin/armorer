const { EleventyHtmlBasePlugin } = require("@11ty/eleventy");
const { default: nodeResolve } = require("@rollup/plugin-node-resolve");
const rollupPlugin = require("eleventy-plugin-rollup");
const commonjs = require("@rollup/plugin-commonjs");
const json = require("@rollup/plugin-json");
const terser = require("@rollup/plugin-terser");
const CleanCSS = require('clean-css');

module.exports = function(eleventyConfig) {
  eleventyConfig.addFilter("cssmin", function(code) {
    return new CleanCSS({}).minify(code).styles;
  });
  eleventyConfig.addPlugin(rollupPlugin, {
    rollupOptions: {
      output: {
        format: "es",
        dir: "_site/js",
      },
      plugins: [
        nodeResolve({
          modulePaths: ["/app", "/workspaces/armorer"],
        }),
        json(),
        commonjs({
          include: /node_modules/,
          requireReturnsDefault: 'auto', // <---- this solves default issue
        }),
        terser(),
      ]
    },
    resolveName(filePath) {
      const crypto = require('crypto');
      const fs = require('fs');
      const hash = crypto.createHash('sha256');
      const path = require('path');
      
      // Read file contents and hash them
      const fileContents = fs.readFileSync(filePath, 'utf8');
      hash.update(fileContents);
      const fileHash = hash.digest('hex');
      const parsedPath = path.parse(filePath);
      return `${parsedPath.name}-${fileHash.slice(0, 6)}.js`;
    }
  });
  eleventyConfig.addPlugin(rollupPlugin, {
    scriptGenerator: (filename) => filename, // do not add <script> tags
    shortcode: "rollup_web_worker",
    rollupOptions: {
      output: {
        format: "es",
        dir: "_site/js",
      },
      plugins: [
        nodeResolve({
          modulePaths: ["/app", "/workspaces/armorer"],
        }),
        json(),
        commonjs({
          include: /node_modules/,
          requireReturnsDefault: 'auto', // <---- this solves default issue
        }),
        terser(),
      ]
    },
    resolveName(filePath) {
      const crypto = require('crypto');
      const fs = require('fs');
      const hash = crypto.createHash('sha256');
      const path = require('path');
      
      // Read file contents and hash them
      const fileContents = fs.readFileSync(filePath, 'utf8');
      hash.update(fileContents);
      const fileHash = hash.digest('hex');
      const parsedPath = path.parse(filePath);
      return `${parsedPath.name}-${fileHash.slice(0, 6)}.js`;
    }
  });
  eleventyConfig.addPlugin(EleventyHtmlBasePlugin);
  eleventyConfig.addPassthroughCopy("src/img");
  eleventyConfig.addPassthroughCopy("src/fonts");
  eleventyConfig.addPassthroughCopy("src/js/*.json");
  eleventyConfig.addPassthroughCopy({ "src/favicon": "/" });
  eleventyConfig.addWatchTarget("src/js/");
  eleventyConfig.addWatchTarget("src/css/styles.css");
  return {
    dir: {
      input: "src",
      output: "_site"
    }
  }
};