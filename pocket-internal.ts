import { TextDelimiterStream } from "https://deno.land/std@0.170.0/streams/text_delimiter_stream.ts";

import {
    PocketAuthorization,
    PocketClient,
    PocketSyncCause,
    PocketPartial,
    PocketReactions,
    PocketEntity,
    PocketUser,
    PocketMessage,
    PocketCollection
} from "./pocket-api.ts";

export const endpoint = "https://pb.fireship.app/api";

const source = "https://pocketchat.fireship.app/";

const headers = {
    "content-type": "application/json",
    "origin": source, "referer": source,
    "User-Agent": "PocketBot/0.1 (Deno)"
};

type PocketRawEntity = {
    id: string
    created: string
    updated: string
    collectionId: string
    collectionName: string
}

function nicifyEntity(entity: PocketRawEntity): PocketEntity {
    return {
        id: entity.id,
        timestamps: {
            created: Date.parse(entity.created),
            updated: Date.parse(entity.updated)
        },
        collection: {
            id: entity.collectionId,
            name: entity.collectionName
        }
    };
}

type PocketRawUser = PocketRawEntity & {
    username: string
    emailVisibility: boolean
    verified: boolean
    banned: boolean
}

function nicifyUser(user: PocketRawUser): PocketUser {
    return {
        ...nicifyEntity(user),
        name: user.username,
        status: {
            emailVisibility: user.emailVisibility,
            verified: user.verified,
            banned: user.banned
        }
    };
}

type PocketRawMessage = PocketRawEntity & {
    text: string
    user: string
    hearts: string[]
    poops: string[]
    expand?: {
        user: PocketRawUser
    }
}

function nicifyMessage(message: PocketRawMessage): PocketMessage {
    return {
        ...nicifyEntity(message),
        text: message.text,
        author: message.expand?.user ? nicifyUser(message.expand.user) : { id: message.user },
        reactions: {
            hearts: message.hearts.map(userId => ({ id: userId })),
            poops: message.poops.map(userId => ({ id: userId }))
        }
    };
}

type PocketRawCollection<T extends PocketRawEntity, F extends PocketEntity> = Omit<PocketCollection<F>, "items"> & { items: T[] }

function nicifyCollection<T extends PocketRawEntity, F extends PocketEntity>(
    collection: PocketRawCollection<T, F>,
    mapper: (raw: T) => F
): PocketCollection<F> {
    return {
        perPage: collection.perPage,
        page: collection.page,
        totalPages: collection.totalPages,
        items: collection.items.map(mapper),
        totalItems: collection.totalItems
    };
}

// ---------- AUTH ----------

export async function authenticate(username: string, password: string): Promise<[PocketUser, PocketAuthorization]> {
    const res = await (await fetch(endpoint + "/collections/users/auth-with-password", {
        method: "POST", headers,
        body: JSON.stringify({ identity: username, password: password })
    })).json()
    return [
        nicifyUser(res.record),
        { id: res.record.id, token: res.token }
    ];
}

export async function register(username: string, password: string): Promise<PocketUser> {
    const res = await fetch(endpoint + "/collections/users/records", {
        method: "POST", headers,
        body: JSON.stringify({ username, password, passwordConfirm: password, name: "test" })
    });
    if (!res.ok) {
        throw new Error("Unable to register", { cause: res });
    }
    return nicifyUser(await res.json());
}

// ---------- RETRIEVAL ----------

export async function retrieveMessage(message: PocketPartial<PocketMessage>): Promise<PocketMessage> {
    const res = await fetch(
        endpoint + "/collections/messages/records/" + message.id,
        { headers }
    );
    if (!res.ok) {
        throw new Error("Unable to retrieve message", { cause: res });
    }
    return nicifyMessage(await res.json());
}

export async function retrieveMessages(page: number, perPage: number): Promise<PocketCollection<PocketMessage>> {
    if (perPage < 1 || perPage > 500) {
        throw new Error("Cannot only fetch 1 - 500 messages in one page", { cause: { page, perPage } });
    }
    const res = await fetch(
        `${endpoint}/collections/messages/records?page=${page}&perPage=${perPage}&sort=-created&expand=user`,
        { headers }
    );
    if (!res.ok) {
        throw new Error("Unable to retrieve messages", { cause: res });
    }
    return nicifyCollection(await res.json(), nicifyMessage);
}

export async function retrieveUser(message: PocketPartial<PocketUser>): Promise<PocketUser> {
    const res = await fetch(
        endpoint + "/collections/users/records/" + message.id,
        { headers }
    );
    if (!res.ok) {
        throw new Error("Unable to retrieve user", { cause: res });
    }
    return nicifyUser(await res.json());
}

export async function retrieveUsers(page: number, perPage: number): Promise<PocketCollection<PocketUser>> {
    if (perPage < 1 || perPage > 500) {
        throw new Error("Cannot only fetch 1 - 500 users in one page", { cause: { page, perPage } });
    }
    const res = await fetch(
        `${endpoint}/collections/users/records?page=${page}&perPage=${perPage}`,
        { headers }
    );
    if (!res.ok) {
        throw new Error("Unable to retrieve users", { cause: res });
    }
    return nicifyCollection(await res.json(), nicifyUser);
}

// ---------- CONNECTION ----------

export async function connectPolling(client: PocketClient, opts?: { interval?: number, length?: number }) {
    const length = opts?.length ?? 10;
    (await retrieveMessages(1, length)).items.forEach(message => client.sync(message, "update"));
    client.emit("ready");
    setInterval(async () => {
        (await retrieveMessages(1, length)).items.forEach(message => client.sync(message, "create"));
    }, opts?.interval ?? 10_000);
}

type PocketRealtimeEvent = {
    id: string
    type: string
    data: { action: PocketSyncCause, record: PocketRawMessage }
}

export async function connectRealtime(client: PocketClient) {
    const stream = (await fetch(endpoint + "/realtime")).body!
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TextDelimiterStream("\n\n"))
        .pipeThrough(new TransformStream<string, PocketRealtimeEvent>({
            transform(chunk, controller) {
                if (chunk != "") try {
                    const [id, type, data] = chunk.split("\n");
                    controller.enqueue({
                        id: id.slice(3),
                        type: type.slice(6),
                        data: JSON.parse(data.slice(5))
                    });
                } catch(err) {
                    console.error(err, chunk, chunk.split("\n"));
                }
            }
        }));
    for await (const event of stream) {
        if (event.type == "PB_CONNECT") {
            const subscription = await fetch(endpoint + "/realtime", {
                method: "POST", headers,
                body: JSON.stringify({
                    clientId: event.id,
                    subscriptions: ["messages"]
                })
            });
            if (subscription.status != 204) {
                throw new Error("Invalid subscription confirmation", { cause: subscription });
            }
            client.emit("ready");
        } else {
            client.sync(nicifyMessage(event.data.record), event.data.action);
        }
    }
}

// ---------- ACTIONS ----------

export async function sendMessage(user: PocketPartial<PocketUser>, text: string) {
    const res = await fetch(endpoint + "/collections/messages/records", {
        method: "POST", headers,
        body: JSON.stringify({ user: user.id, text }),
        signal: AbortSignal.timeout(60_000)
    });
    if (!res.ok) {
        throw new Error("Unable to send message", { cause: res });
    }
}

export async function updateReactions(
    message: PocketPartial<PocketMessage>,
    reactions: Partial<PocketReactions>,
    authorization: PocketAuthorization
) {
    const timeToSend: Partial<Record<keyof PocketReactions, string[]>> = {};
    if (reactions.poops) {
        timeToSend.poops = reactions.poops.map(reaction => reaction.id);
    } else if (reactions.hearts) {
        timeToSend.hearts = reactions.hearts.map(reaction => reaction.id);
    }
    const res = await fetch(endpoint + "/collections/messages/records/" + message.id, {
        method: "PATCH",
        headers: {
            ...headers,
            authorization: authorization.token
        },
        body: JSON.stringify(timeToSend),
        signal: AbortSignal.timeout(60_000)
    });
    if (!res.ok) {
        throw new Error("Unable to update reactions", { cause: res });
    }
}