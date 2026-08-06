'use strict';

const { readFileSync, writeFileSync } = require('fs');
const { resolve, dirname } = require('path');
const stylus = require('stylus');

hexo.extend.generator.register('custom-stylus-css', () => {
  const stylPath = resolve(hexo.source_dir, '_data/styles.styl');
  let code;
  try {
    code = readFileSync(stylPath, 'utf8');
  } catch (e) {
    return;
  }

  const renderResult = stylus(code, { filename: stylPath }).render();
  return {
    path: 'css/custom-injected.css',
    data: renderResult,
  };
});

hexo.extend.filter.register('after_render:html', (str, data) => {
  if (data.path && (data.path.includes('aigc_art_styles_guide') || data.path.includes('ai_art_magazine'))) {
    const linkTag = '<link rel="stylesheet" href="' + hexo.config.root + 'css/custom-injected.css">';
    if (str.includes('</head>')) {
      return str.replace('</head>', '  ' + linkTag + '\n</head>');
    }
  }
  return str;
});
