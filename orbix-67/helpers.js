//////////////////////
// GLOBAL VARIABLES //
//////////////////////

const avatarMap = new Map();
const pronounMap = new Map();

// const testFirstMessage = GetBooleanParam("testFirstMessage", false);



//////////////////////
// HELPER FUNCTIONS //
//////////////////////

function GetBooleanParam(paramName, defaultValue) {
	const urlParams = new URLSearchParams(window.location.search);
	const paramValue = urlParams.get(paramName);

	if (paramValue === null) {
		return defaultValue; // Parameter not found
	}

	const lowercaseValue = paramValue.toLowerCase(); // Handle case-insensitivity

	if (lowercaseValue === 'true') {
		return true;
	} else if (lowercaseValue === 'false') {
		return false;
	} else {
		return paramValue; // Return original string if not 'true' or 'false'
	}
}

function GetIntParam(paramName, defaultValue) {
	const urlParams = new URLSearchParams(window.location.search);
	const paramValue = urlParams.get(paramName);

	if (paramValue === null) {
		return defaultValue; // or undefined, or a default value, depending on your needs
	}

	const intValue = parseInt(paramValue, 10); // Parse as base 10 integer

	if (isNaN(intValue)) {
		return null; // or handle the error in another way, e.g., throw an error
	}

	return intValue;
}

async function GetKickIds(username) {
    // First attempt with the original username
    let url = `https://kick.com/api/v2/channels/${username}`;

    try {
        let response = await fetch(url);
        if (!response.ok) {
            // Retry with underscores replaced by dashes
            const altUsername = username.replace(/_/g, "-");
            url = `https://kick.com/api/v2/channels/${altUsername}`;
            response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }
        }

        const data = await response.json();
        if (data.chatroom && data.chatroom.id) {
            return { chatroomId: data.chatroom.id, channelId: data.chatroom.channel_id };
        } else {
            throw new Error("Chatroom ID not found in response.");
        }
    } catch (error) {
        console.error("Failed to fetch chatroom ID:", error.message);
        return null;
    }
}

async function GetKickSubBadges(username) {
    let url = `https://kick.com/api/v2/channels/${username}`;

    try {
        let response = await fetch(url);
        if (!response.ok) {
            // Retry with underscores replaced by dashes
            const altUsername = username.replace(/_/g, "-");
            url = `https://kick.com/api/v2/channels/${altUsername}`;
            response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }
        }

        const data = await response.json();
        return data.subscriber_badges || [];
    } catch (error) {
        console.error("Failed to fetch subscriber badges:", error.message);
        return [];
    }
}

async function GetAvatar(username, platform) {
    // First, check if the username is hashed already
    if (avatarMap.has(`${username}-${platform}`)) {
        console.debug(`Avatar found for ${username} (${platform}). Retrieving from hash map.`);
        return avatarMap.get(`${username}-${platform}`);
    }

    // If code reaches this point, the username hasn't been hashed, so retrieve avatar
    switch (platform) {
        case 'twitch': {
            console.debug(`No avatar found for ${username} (${platform}). Retrieving from Decapi.`);
            let response = await fetch('https://decapi.me/twitch/avatar/' + username);
            let data = await response.text();
            avatarMap.set(`${username}-${platform}`, data);
            return data;
        }
        case 'kick': {
            console.debug(`No avatar found for ${username} (${platform}). Retrieving from Kick.`);

            let url = `https://kick.com/api/v2/channels/${username}`;
            try {
                let response = await fetch(url);
                if (!response.ok) {
                    // Retry with underscores replaced by dashes
                    const altUsername = username.replace(/_/g, "-");
                    url = `https://kick.com/api/v2/channels/${altUsername}`;
                    response = await fetch(url);
                    if (!response.ok) {
                        throw new Error(`HTTP error ${response.status}`);
                    }
                }

                let data = await response.json();
                let avatarURL = data.user?.profile_pic || 'https://kick.com/img/default-profile-pictures/default2.jpeg';
                avatarMap.set(`${username}-${platform}`, avatarURL);
                return avatarURL;
            } catch (error) {
                console.error("Failed to fetch avatar:", error.message);
                return 'https://kick.com/img/default-profile-pictures/default2.jpeg';
            }
        }
    }
}

async function GetPronouns(platform, username) {
	if (pronounMap.has(username)) {
		console.debug(`Pronouns found for ${username}. Retrieving from hash map.`)
		return pronounMap.get(username);
	}
	else {
		console.debug(`No pronouns found for ${username}. Retrieving from alejo.io.`)
		const response = await client.getUserPronouns(platform, username);
		const userFound = response.pronoun.userFound;
		const pronouns = userFound ? `${response.pronoun.pronounSubject}/${response.pronoun.pronounObject}` : '';

		pronounMap.set(username, pronouns);

		return pronouns;
	}
}

function GetCurrentTimeFormatted() {
	const now = new Date();
	const hours = String(now.getHours()).padStart(2, '0');
	const minutes = String(now.getMinutes()).padStart(2, '0');

	const formattedTime = `${hours}:${minutes}`;
	return formattedTime;
}

function DecodeHTMLString(html) {
	var txt = document.createElement("textarea");
	txt.innerHTML = html;
	return txt.value;
}

// Simple HTML escape function to prevent XSS attacks
function EscapeHTML(str) {
	return str.replace(/[&<>"']/g, match => {
		const escape = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
		return escape[match];
	});
}

// Used to construct a message from "parts" variable commonly found in Streamer.bot chat messages (EventSub)
function ConstructMessageFromParts(parts) {
	return parts.map(part => {
		if (part.emoji)
			return ` <img src="${EscapeHTML(part.image)}" alt="${EscapeHTML(part.text)}" title="${EscapeHTML(part.text)}" class="emote"> `;
		if (!part.type)
			return EscapeHTML(part.text);
		if (part.source == 'Twemoji')
			return EscapeHTML(part.text);

		switch (part.type)
		{
			case "text":
				return EscapeHTML(part.text);
			case "cheer":
				let imageUrl = '';

				if (!part.imageUrl) {
					const tiers = [100000, 10000, 5000, 1000, 100, 10, 1];
					const activeTier = tiers.find(tier => part.bits >= tier) || 1;
					part.imageUrl = `https://d3aqoihi2n8ty8.cloudfront.net/actions/cheer/dark/animated/${activeTier}/4.gif`;
				}

				const emoteImg = `<img src="${EscapeHTML(part.imageUrl)}" alt="${EscapeHTML(part.text)}" title="${EscapeHTML(part.text)}" class="emote">`;
				const bitLabel = `<span class="bits">${EscapeHTML(part.bits.toString())}</span>`;

				return emoteImg + bitLabel;
			case "mention":
				return part.text;
			default:
				return `<img src="${EscapeHTML(part.imageUrl)}" alt="${EscapeHTML(part.text)}" title="${EscapeHTML(part.text)}" class="emote">`;
		}
	}).join('');
}

function TranslateToFurry(sentence) {
	// Split on <img ...> tags, keeping them in the result so emote images aren't mangled
	const parts = sentence.split(/(<img\b[^>]*>)/gi);

	const furryParts = parts.map(part => {
		// If this part is an <img>, leave it unchanged
		if (/^<img\b[^>]*>$/.test(part)) {
			return part;
		}

		// Otherwise, apply furry translation
		const words = part.toLowerCase().split(/\b/);

		return words.map(word => {
			if (/\w+/.test(word)) {
				let newWord = word;

				// Common substitutions
				newWord = newWord.replace(/l/g, 'w');
				newWord = newWord.replace(/r/g, 'w');
				newWord = newWord.replace(/th/g, 'f');
				newWord = newWord.replace(/you/g, 'yous');
				newWord = newWord.replace(/my/g, 'mah');
				newWord = newWord.replace(/me/g, 'meh');
				newWord = newWord.replace(/am/g, 'am');
				newWord = newWord.replace(/is/g, 'is');
				newWord = newWord.replace(/are/g, 'are');
				newWord = newWord.replace(/very/g, 'vewy');
				newWord = newWord.replace(/pretty/g, 'pwetty');
				newWord = newWord.replace(/little/g, 'wittle');
				newWord = newWord.replace(/nice/g, 'nyce');

				// Random additions
				if (Math.random() < 0.15) {
					newWord += ' nya~';
				} else if (Math.random() < 0.1) {
					newWord += ' >w<';
				} else if (Math.random() < 0.05) {
					newWord += ' owo';
				}

				return newWord;
			}
			return word;
		}).join('');
	});

	return furryParts.join('');
}

function EscapeRegExp(string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

// TEST FIRST MESSAGE
// window.addEventListener("load", async () => {
//   if (!testFirstMessage) return;

//   await TwitchChatMessage({
//     message: {
//       msgId: "test-first-message",
//       username: "viewer",
//       displayName: "viewer",
//       color: "#00d1ff",
//       message: "Test: premier message (bandeau + highlight).",
//       firstMessage: true,
//       isReply: false,
//       reply: null,
//       role: 1,
//       subscriber: false,
//       badges: [],
//       isMe: false,
//     },
//     user: { id: "test-user" },
//     emotes: [],
//     cheerEmotes: [],
//     isFromSharedChatGuest: false,
//     sharedChatSource: { name: "", login: "" },
//   });
// });
