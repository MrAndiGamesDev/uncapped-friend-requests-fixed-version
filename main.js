// Function to check if the current URL matches the specified pattern
function checkURL() {
  const url = window.location.href;
  //console.log(`FRIEND | URL reported: ${url.includes("friends#!/friend-requests")}`)
  return url.includes("friends#!/friend-requests");
}

// Function to check if the popup should be shown
function shouldShowPopup() {
  return !localStorage.getItem("doNotShowPopup");
}

// Wait for the friends-subtitle element and check the URL
waitForElm(".notification-blue.notification").then(async (notif) => {
  const notificationElements = document.getElementsByClassName("notification-blue notification");
  let targetFriendSub = null;

  // Find the relevant notification element (e.g., one displaying "500+" or the primary one)
  if (notificationElements.length > 0) {
    for (const element of notificationElements) {
      if (element.innerHTML === "500+") {
        targetFriendSub = element;
        break;
      }
    }
    // If no "500+" found, use the first notification element as a fallback
    if (!targetFriendSub) {
      targetFriendSub = notificationElements[0];
    }
  }

  if (targetFriendSub) {
    // Set initial loading state
    targetFriendSub.innerHTML = "Loading...";
    targetFriendSub.setAttribute('id', 'friendSub');

    if (checkURL()) {
      waitForElm(".friends-subtitle").then((friendsSubtitle) => {
        if (friendsSubtitle.innerHTML.includes("Requests")) {
          friendsSubtitle.innerHTML = "Friend Requests (Loading...)";
          friendsSubtitle.setAttribute('id', "friendsSubtitleRequests");
        }
      });
    }

    chrome.runtime.sendMessage({ action: "start" }, function (response) {
      const count = response.req;
      targetFriendSub.innerHTML = count;
      console.log(`FRIEND | Requests count: ${count}`);

      if (checkURL()) {
        waitForElm(".friends-subtitle").then((friendsSubtitle) => {
          if (friendsSubtitle.innerHTML.includes("Requests")) {
            friendsSubtitle.innerHTML = `Friend Requests (${count})`;
          }
        });
      }
    });
  } else {
    // If no notification element is found at all, then display the popup message.
    console.log("FRIEND | No notification element found to update. Displaying popup.");
    displayPopupMessage();
  }
});

function waitForElm(selector) {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) {
      return resolve(document.querySelector(selector));
    }

    const observer = new MutationObserver((mutations) => {
      if (document.querySelector(selector)) {
        resolve(document.querySelector(selector));
        observer.disconnect();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
}

function displayPopupMessage() {
  // Display a popup message on the site
  if (shouldShowPopup()) {
    const popupMessage = document.createElement("div");
    popupMessage.innerHTML = `
      <div>You have less than 500 friend requests.</div>
      <div>The Uncapped Roblox Friend Requests extension is unnecessary.</div>
      <div>You may run into issues if you continue to use the extension with less than 500 friend requests.</div>
      <button id="doNotShowAgain">Do Not Show Again</button>
      <div>Closing in 15 seconds...</div>
    `;
    popupMessage.style.position = "fixed";
    popupMessage.style.top = "50%";
    popupMessage.style.left = "50%";
    popupMessage.style.color = "#000";
    popupMessage.style.transform = "translate(-50%, -50%)";
    popupMessage.style.background = "#fff";
    popupMessage.style.padding = "20px";
    popupMessage.style.border = "2px solid #333";
    popupMessage.style.zIndex = "9999";
    document.body.appendChild(popupMessage);

    // Remove the popup after 5 seconds
    setTimeout(() => {
      popupMessage.remove();
    }, 15000);

    const doNotShowAgainBtn = popupMessage.querySelector("#doNotShowAgain");
    if (doNotShowAgainBtn) {
      doNotShowAgainBtn.addEventListener("click", () => {
        popupMessage.remove(); // Remove the popup
        // Store a flag in local storage to prevent showing the popup again
        localStorage.setItem("doNotShowPopup", true);
      });
    }
  }
}