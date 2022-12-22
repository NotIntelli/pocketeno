import { EventEmitter } from "https://deno.land/x/evtemitter@2.0.0/EventEmitter.ts";
import { sendMessage, updateReactions } from "./pocket-internal.ts";

export type PocketIdentified = { id: string }

export type PocketNamed = { name: string }

export type PocketSyncCause = "create" | "update"

export type PocketPartial<T extends PocketEntity> = Partial<T> & PocketIdentified

export interface PocketEntity extends PocketIdentified {
    collection: PocketIdentified & PocketNamed
    timestamps: {
        created: number
        updated: number
    }
}

export interface PocketUser extends PocketNamed, PocketEntity {
    status: {
        emailVisibility: boolean
        verified: boolean
        banned: boolean
    }
}

export interface PocketReactions {
    hearts: PocketPartial<PocketUser>[]
    poops: PocketPartial<PocketUser>[]
}

export type PocketReactionType = keyof PocketReactions

export interface PocketMessage extends PocketEntity {
    text: string
    author: PocketPartial<PocketUser>
    reactions: PocketReactions
}

export interface PocketCollection<T extends PocketEntity> {
    perPage: number
    page: number
    totalPages: number
    items: T[]
    totalItems: number
}

export interface PocketAuthorization extends PocketIdentified {
    token: string
}

export class PocketClient extends EventEmitter<{
    ready: []
    discovered: [PocketMessage],
    created: [PocketMessage],
    reacted: [PocketMessage, PocketReactions, PocketReactions]
}> {

    public authorization: PocketAuthorization;

    public constructor(authorization: PocketAuthorization) {
        super();
        this.authorization = authorization;
    }

    public messages: Record<string, PocketMessage> = {};

    public send(text: string) {
        return sendMessage(this.authorization, text);
    }

    public poop(message: PocketMessage) {
        return updateReactions(message, {
            poops: [...message.reactions.poops, { id: this.authorization.id }]
        }, this.authorization);
    }

    public heart(message: PocketMessage) {
        return updateReactions(message, {
            hearts: [...message.reactions.hearts, { id: this.authorization.id }]
        }, this.authorization);
    }

    #exclude(from: PocketReactions, values: PocketReactions): PocketReactions {
        return {
            hearts: from.hearts.filter(rec => !values.hearts.some(oRec => rec.id == oRec.id)),
            poops: from.poops.filter(rec => !values.poops.some(oRec => rec.id == oRec.id))
        };
    }

    public sync(message: PocketMessage, cause: PocketSyncCause) {
        const original = this.messages[message.id];
        if (cause == "update") {
            this.emit("reacted",
                message,
                !original ? message.reactions : this.#exclude(message.reactions, original.reactions),
                !original ? { hearts: [], poops: [] } : this.#exclude(original.reactions, message.reactions)
            );
        }
        if (!original) {
            this.emit("discovered", message);
            if (cause == "create") {
                this.emit("created", message);
            }
        }
    }

}