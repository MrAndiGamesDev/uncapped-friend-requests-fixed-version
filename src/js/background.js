async function getRobloxCookie() {
  let rawCookie = "";
  const cookies = await new Promise((resolve) => {
    chrome.cookies.getAll({ domain: "roblox.com" }, resolve);
  });

  for (const cookie of cookies) {
    rawCookie += `${cookie.name}=${cookie.value}; `;
  }

  if (!rawCookie) {
    throw new Error("No cookies found.");
  }

  return rawCookie.slice(0, -2); // Remove trailing space and semicolon
}

async function fetchFriendRequests(rawCookie) {
  let totalRequests = 0;
  let cursor = "";
  let hasNextPage = true;

  while (hasNextPage) {
    const url = `https://friends.roblox.com/v1/my/friends/requests?limit=100&cursor=${encodeURIComponent(cursor)}&sortOrder=Desc`;
    const requestOptions = {
      method: "GET",
      headers: {
        Cookie: rawCookie,
      },
    };

    const response = await fetch(url, requestOptions);
    const data = await response.json();

    if (data.data && data.data.length > 0) {
      totalRequests += data.data.length;
      console.log("Friend Requests:", totalRequests);
      cursor = data.nextPageCursor;
      hasNextPage = !!cursor;
    } else {
      hasNextPage = false;
    }
  }
  return totalRequests;
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  // If it returns false or nothing, the message channel closes before sendResponse can be called.
  if (request.action === "start") {
    // This function must return true to indicate that sendResponse will be called asynchronously.
    (async () => {
      try {
        const rawCookie = await getRobloxCookie();
        // console.log("Raw Cookie:", rawCookie);

        const totalRequests = await fetchFriendRequests(rawCookie);
        sendResponse({ req: totalRequests });
      } catch (error) {
        console.error("Friend request fetching error:", error);
        sendResponse({ req: `Error: ${error.message}` });
      }
    })();
    return true; // Important: Return true to keep the message channel open
  }
});