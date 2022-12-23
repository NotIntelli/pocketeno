# Pocketeno
[PocketChat](https://pocketchat.fireship.app/) client for Deno

Pocketeno is a high performance 🚀 Deno client for [PocketChat by Fireship](https://www.youtube.com/watch?v=gUYBFDPZ5qk)

### Update

[PocketChat has been shut down](https://www.youtube.com/watch?v=M93w3TjzVUE) 💀 **by the FBI** citing the reason *"it was a threat to national security"*

⚠ No updates for now. This project **will not be worked** on until further notice

o7 PocketChat (2022 - 2022)

## Usage

```typescript
import { PocketClient } from "./pocket-api.ts";
import { authenticate, connectRealtime, connectPolling } from "./pocket-internal.ts";

const username = ..., password = ...

const auth = await authenticate(username, password);

const client = new PocketClient(auth);

client.on("ready", () => {
  //Will run when connected and receiving messages ...
});

client.on("created", (message) => {
  if (message.text == "ping") {
    client.send("Pong!"); // Send a message
  }
  //Will run when a message is received ...
});

client.on("updated", (message, added, removed) => {
  if (added.hearts?.length > 0) {
    client.heart(message); // Heart when someone else hearts
  }
  //Will run when reactions have changed (added / removed) ...
  //Although it is impossible to remove reactions from the frontend it IS POSSIBLE
});

connectRealtime(client); // Connect using the realtime endpoint HTTP stream (unreliable, inexpensive)

connextPolling(client, { interval: 2_500, length: 15 }); // Connect by polling the retrieve messages endpoint at an interval (reliable, expensive)

```

### Tomfoolery

```typescript
import { sendMessage, updateReactions } from "./pocket-internal.ts";

const client = ...

client.on("created", (message) => { 
  
  const author = message.author;
  
  if (author.id == client.authorization.id) { //Don't reply to our own messages
    return;
  }
  
  //Impersonate a message
  sendMessage(user, "I am not you but me");
  
  //Remove all poops
  updateReactions(message, { poops: [] }, client.authorization);
  
  //Poop a message to death
  updateReactions(message, { poops: [ id1, id2, id3, id4, id5 ] }, client.authorization);
  
});
```

### License

[MIT License](LICENSE)