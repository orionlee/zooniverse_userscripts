// ==UserScript==
// @name        Zooniverse Search Talk Board Comments
// @namespace   zooniverse
// @match       https://www.zooniverse.org/*
// @grant       none
// @version     1.2.0
// @author      -
// @description Search comments of the current talk board.
//              Can be used as an approximation of searching for recently tagged subjects on Notes.
// @icon        https://www.zooniverse.org/favicon.ico
// ==/UserScript==


// BEGIN generic AJAX helpers
//

/**
 * Call the supplied function when there is an URL change,
 * typically used in a site with AJAX.
 *
 * The supplied function should check current URL to ensure
 * the page is what it intends to modify.
 */
function runOnUrlChange(urlChangeFunc) {
  // fire it when URL is changed (due to some ajax codes)
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      urlChangeFunc();
      lastUrl = location.href;
    }
  }).observe(document, {subtree: true, childList: true});
}

/**
 * Run the supplied function once when the UI is ready.
 *
 * The supplied function must first test if the UI is ready,
 * and return false if the UI is not ready.
 * If the UI is ready, and the function finishes it works,
 * it must return true.
 */
function runOnceWhenReady(func, timeout=5000) {
  let done = func();
  console.debug('runOnceWhenReady(), init result=', done);
  if (done) {
    return;
  }

  console.debug('runOnceWhenReady(), setting up observer...');
  let numCalled = 0;
  new MutationObserver((mutations, observer) => {
    try {
      done = func();
      numCalled++;
      if (done) {
        observer.disconnect();
      }
    } catch (e) {
      console.error(e);
      observer.disconnect();
    }
  }).observe(document, {subtree: true, childList: true});

  // the timeout is a last resort catch all to handle edge cases such as rare race conditions
  console.debug('runOnceWhenReady(), setting up timeout...');
  setTimeout(() => {
    if (done) {
      return;
    }
    console.debug('runOnceWhenReady(), run upon timeout. done=', done, ', numCalled=', numCalled);
    done = func();
    if (!done) {
      console.warn(`runOnceWhenReady() the UI is not ready after ${timeout}ms. Possibly no-op.`);
    }
  }, timeout);
}

//
// END generic AJAX helpers


function formatCommentAsExcerpt(text) {
  // format the markdown-based comment as excerpt to be used within in <a> tag below

  // remove img ![alt](url)
  text = text.replace(/!\[([^\]]+)\]\(([^)]+)\)/g, '');

  // remove link [title](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');

  const maxLength = 78;
  if (text.length <= maxLength) {
    return text;
  } else{
    return text.substr(0, 78) + "...";
  }
}


async function searchBoardComments(boardId, queryRe, startPage, endPage, pageSize=100) {

  // convert startPage / endPage based on page_size of 10 (ZN default) to a custom pageSize of 100,
  // to reduce num. of AJAX calls
  // The larger page size could make the result have more entries than the specified start / end page,
  // but should be acceptable
  if (pageSize > 100) {
    pageSize = 100;  // ZN's max
  }
  pageSizeRatio = pageSize / 10;  // the ratio to the default  ZN page size
  startPage = Math.ceil(startPage / pageSizeRatio);
  endPage = Math.ceil(endPage / pageSizeRatio);
  // console.debug(`searchBoardComments() adjusted pages: [${startPage}, ${endPage}] , pageSize=${pageSize}`);

  // Note: ZN has a cap of max page_size=100, so to cover a larger range, we need to make multiple calls
  async function fetchPageAsJson(page) {
    const resp = await fetch(
      `https://talk.zooniverse.org/discussions?http_cache=true&board_id=${boardId}&page_size=${pageSize}&page=${page}`,
      {
        headers: {
          'Accept': 'application/vnd.api+json; version=1',
          'Content-Type': 'application-json',
        }
      }
    );
    return await resp.json();
  }

  function doMap(d) {
    // d: a discussion json
    c = d.latest_comment
    return {
      title: d.title,
      body: c.body,
      updated_at: c.updated_at,
      url: `/projects/${d.project_slug}/talk/${d.board_id}/${c.discussion_id}?comment=${c.id}`,
      user_display_name: c.user_display_name,
      user_project_url: `/projects/${d.project_slug}/users/${c.user_login}`,
      discussion_comments_count: c.discussion_comments_count,
      discussion_users_count: c.discussion_users_count,
    }
  }

  function searchBoardCommentsResponse(resp) {
    // ignore \n\r during search to support search term spanning across multiple lines
    // also search discussion title , as it's shown to users, and they might expect
    // it's searchable
    return resp.discussions
      .filter((d) => queryRe.test(d.title + " " + d.latest_comment.body.replace(/[\n\r]/g, ' ')))
      .map(doMap);
  }

  async function searchPage(page) {
    return searchBoardCommentsResponse(await fetchPageAsJson(page));
  }

  const pages = (() => {
    const res = [];
    for (let i = startPage; i <= endPage; i++) {
      res.push(i);
    }
    return res;
  })();
  const allRes = await Promise.allSettled(pages.map(page => searchPage(page)));

  const unfulfilledRes = allRes.filter(r => r.status !== 'fulfilled');
  if (unfulfilledRes.length > 0) {
    console.warn(`${unfulfilledRes.length} page(s) cannot be fetched during search. `, unfulfilledRes);
  }

  return allRes.filter(r => r.status === 'fulfilled')
    .map(r => r.value) // the actual response object array
    .flat();

} // function searchBoardComments()


async function doSearchAndShowResult() {
  // Gather parameters from the form
  const searchFormCtr = document.querySelector('#talk-board-search-ctr')
  const boardId = searchFormCtr.querySelector('input[name="boardId"]').value;
  // case insensitive search
  const queryRe = new RegExp(searchFormCtr.querySelector('input[name="term"]').value, "i");
  const startPage = searchFormCtr.querySelector('input[name="startPage"]').value;
  const endPage = searchFormCtr.querySelector('input[name="endPage"]').value;

  const outCtr = document.querySelector('.talk-list-content section');
  outCtr.innerHTML = `
<span class="loading-indicator" style="visibility: visible;"><span class="loading-indicator-icon"></span> </span>
Searching...
`;

  // do the search
  const resp = await searchBoardComments(boardId, queryRe, startPage, endPage);
  // console.debug(resp);

  // render the result
  // - body is in markdown, just render an excerpt

  const sIf = (count) => (count > 1) ? "s" : "";

  function formatDateTime(dtIsoStr) {
    const minsAgo = (Date.now() - Date.parse(dtIsoStr)) / 1000 / 60;
    if (minsAgo < 60) {
      return `${minsAgo.toFixed(0)} minute${sIf(minsAgo)} ago`;
    }
    const hoursAgo = minsAgo / 60;
    if (hoursAgo < 24) {
      return `${hoursAgo.toFixed(0)} hour${sIf(hoursAgo)} ago`;
    }
    const daysAgo = hoursAgo / 24;
    return `${daysAgo.toFixed(0)} day${sIf(daysAgo)} ago`;
  }

  const resBody = resp.map(r => `
<div class="talk-discussion-preview">
  <div class="preview-content">
    <h1><a href="${r.url}">${r.title}</a></h1>
    <div class="talk-latest-comment-link">
      <div class="talk-discussion-link">
        <a class="user-profile-link" href="${r.user_project_url}">${r.user_display_name}</a>
        <div class="talk-display-roles"></div>
        <span> </span>
        <a class="latest-comment-time" href="${r.url}">${formatDateTime(r.updated_at)}</a>
        <a class="latest-comment-preview-link" href="${r.url}">
          ${formatCommentAsExcerpt(r.body)}
        </a>
      </div>
    </div>
  </div>
  <div class="preview-stats">
    <p><i class="fa fa-user"></i> ${r.discussion_users_count} Participant${sIf(r.discussion_users_count)}</p>
    <p><i class="fa fa-comment"></i> ${r.discussion_comments_count} Comment${sIf(r.discussion_comments_count)}</p>
  </div>
</div>
`).join('\n');

  outCtr.innerHTML = `
<h4>${resp?.length} Comments with ${queryRe}</h4>
${resBody}
`;
} // function doSearchAndShowResult()


function initTalkBoardSearch() {
  const [, boardId] = location.pathname.match(/.+\/talk\/(\d+.)$/) || [null, null];
  if (!boardId) {
    // not on a talk board
    return;
  }

  // delay the actual tweaks until ajax loading is done
  function doInit() {
    // console.debug(`initTalkBoardSearch(), boardId=${boardId}`);

    // Test if DOM is ready for modification
    // tricky:
    // - testing the presence of 'h1.talk-page-header' is not sufficient,
    //   as ZN seems to have overwritten the header in its codes
    //   So when the header DOM is present, any modification we make here
    //   is likely to be overwritten by ZN codes
    // - empirically, testing of actual comments being displayed
    //   using '.talk-discussion-preview' appears to be a reliable indicator.
    if (!document.querySelector('.talk-discussion-preview')) {
      return false;  // The needed DOM has not been rendered yet.
    }

    const anchorEl = document.querySelector('h1.talk-page-header');
    anchorEl.insertAdjacentHTML('beforeend', `
<div id="talk-board-search-ctr"
     style="display: inline-block; font-size: 1rem; margin-left: 32px; margin-top: 8px; vertical-align: top;">
  <details>
      <summary>Search board</summary>
      Term: <input name="term" placeholder="Search term (regexp)">
      start page: <input name="startPage" value="1" size="4">
      end page: <input name="endPage" value="10" size="4">
      <input name="boardId" value="${boardId}" type="hidden">
      <button id="searchBoardCommentsCtl">Go</button>
  </details>
</div>
`);
    document.getElementById('searchBoardCommentsCtl').onclick = doSearchAndShowResult;
    return true;
  }  // function doInit()
  runOnceWhenReady(doInit);
}
initTalkBoardSearch();
runOnUrlChange(initTalkBoardSearch);
