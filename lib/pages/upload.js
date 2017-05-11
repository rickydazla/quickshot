
let _ = require('lodash');
let { loadConfig, getTarget, log } = require('../helpers');
let fs = require('fs');
fs.mkdirp = require('mkdirp');
Promise.promisifyAll(fs);
let path = require('path');
let asyncEach = require('../asyncEach');
let requestify = require('../requestify');
let axios = require('axios');

module.exports = function *(argv) {
  let config = yield loadConfig();
  let total = 0;

  let target = yield getTarget(config, argv);

  let targetPageCalc = yield axios.get(`https://${target.api_key}:${target.password}@${target.domain}.myshopify.com/admin/pages/count.json`, {

  })
  .then(function (response) {
    return Math.ceil(response.data.count/250);
  })
  .catch(function (error) {
    console.log(error);
  });

  function* getTargetPages(page) {
    console.log('Fetching Page:', page);
    yield axios.get(`https://${target.api_key}:${target.password}@${target.domain}.myshopify.com/admin/pages.json?limit=250&page=${page}`, {

    })
    .then(function (response) {
      return response.data.pages;
    })
    .catch(function (error) {
      console.log(error);
    });
  }

  let targetPageCollection = [];
  let i;
  for (i = 1; i <= targetPageCalc; i++) { 
    let result = yield getTargetPages(i).next().value;
    targetPageCollection.push(result);
  }
  let targetPages = [].concat(...targetPageCollection);

  let pageDirs = fs.readdirSync(path.join(process.cwd(), 'pages')).filter(function (file) {
    return fs.statSync(path.join(process.cwd(), 'pages', file)).isDirectory();
  });

  yield asyncEach(pageDirs, function *(pageDir) {

    let pagePath = path.join(process.cwd(), 'pages', pageDir);

    let pageJson = yield fs.readFileAsync(path.join(pagePath, 'page.json'), 'utf8');

    let page = _.find(targetPages, { 'handle': pageDir});
    let fileHandle = path.basename(pageDir, '.html');

    let pageData = _.omit(JSON.parse(pageJson), 'id');
    pageData.body_html = yield fs.readFileAsync(path.join(pagePath, 'page.html'), 'utf8');

    let newPage;
    if (!_.isEmpty(page)) {
      let pageObj = {
        id: page.id,
        body_html: pageData.body_html
      };
      console.log('update', pageDir);
      newPage = yield requestify(target, {
        method: 'put',
        url: `/admin/pages/${page.id}.json`,
        data: { page: pageObj}
      });
      newPage = newPage.page;
    } else {
      console.log('new', pageDir);
      let pageData = _.omit(JSON.parse(pageJson), 'handle');
      let pageObj = {
        title: _.startCase(pageData.title),
        body_html: pageData.body_html,
        handle: fileHandle
      };
      newPage = yield requestify(target, {
        method: 'post',
        url: `/admin/pages.json`,
        data: { page: pageObj }
      });

      newPage = newPage.page;
    }

    let metaJson = yield fs.readFileAsync(path.join(pagePath, 'metafields.json'), 'utf8');
    let metafields = JSON.parse(metaJson);

    yield asyncEach(metafields, function *(metafield) {
      yield requestify(target, {
        method: 'post',
        url: `/admin/pages/${newPage.id}/metafields.json`,
        data: { metafield: metafield }
      });
    }, {concurrency: config.concurrency});

    total += 1;
  }, {concurrency: config.concurrency});

  return `Uploaded ${total} pages.`;
};
