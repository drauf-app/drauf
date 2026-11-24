# Sync protocol

Drauf keeps clients in sync with two mechanisms:

1. **Live updates** over a WebSocket, so changes reach everyone in under two
   seconds while online.
2. **Offline operations**: clients queue mutations locally and replay them via
   `POST /api/sync/operations` when connectivity returns.

## Conflict rules

- **Last write per field wins.** Every list entry keeps a per-field clock
  (`fieldTimes`). An operation's client timestamp decides the winner per field,
  so two people editing different fields of the same item both succeed.
- **A check-off wins over an edit.** Edits never change the checked state, and
  an uncheck older than the check-off is refused (`conflict`).
- Client timestamps are capped at the server clock: a device with a skewed
  clock cannot claim writes from the future.
- Operation ids are client-generated and recorded server-side; replaying an
  already-processed operation answers `duplicate` and changes nothing.

## Offline operations

`POST /api/sync/operations` (Bearer auth) with up to 100 operations, applied in
order:

```json
{
  "operations": [
    {
      "id": "0193e1c2-…",
      "type": "entry.add",
      "time": "2026-11-11T18:00:00.000Z",
      "data": { "listId": "…", "name": "Milch", "quantity": 1, "unit": "l" }
    }
  ]
}
```

| Type              | Data                                                                                              | Behaviour                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entry.add`       | `listId`, `name`, optional `quantity`, `unit`, `variant`, `note`, `categoryId`                    | Same merge semantics as the REST endpoint                                                                                                                                                           |
| `entry.setFields` | `listId`, `entryId`, `fields` (any of `name`, `variant`, `note`, `categoryId`, `quantity`+`unit`) | Per-field LWW; applies the winning fields, `conflict` if none wins                                                                                                                                  |
| `entry.check`     | `listId`, `entryId`                                                                               | Idempotent; the first check-off sticks                                                                                                                                                              |
| `entry.uncheck`   | `listId`, `entryId`                                                                               | Applies only when newer than the check-off                                                                                                                                                          |
| `entry.delete`    | `listId`, `entryId`                                                                               | Idempotent                                                                                                                                                                                          |
| `portion.set`     | `listId`, `entryId`, `portionId`, optional `quantity`, `unit`, `count`                            | Replaces the one portion's value; absent fields become null. The three fields share one clock: LWW against the portion's `updatedAt` (its `createdAt` before the first edit), `conflict` when older |
| `portion.delete`  | `listId`, `entryId`, `portionId`                                                                  | Idempotent; deleting the last portion deletes the entry (emits `entry.deleted`)                                                                                                                     |

The response carries one result per operation: `applied`, `duplicate`,
`conflict` or `rejected` (with an error code), plus the `entryId` where
relevant — and, for `entry.add`, the `portionId` of the portion the add
created, so clients can later edit exactly their own contribution of a
merged entry. Conflict outcomes are terminal: replaying them yields
`duplicate`.

Portion-level edits exist for clients that edit a single contribution of a
merged entry (L4 traceability — the iOS chip bar edits exactly the portion
its add created). `entry.setFields` with `quantity`/`unit`/`count` keeps its
replace-all-portions semantics for whole-quantity edits.

Offline replay covers list entries — the flows that genuinely happen without
connectivity (adding and checking off while shopping). Everything else uses the
regular REST API online.

## WebSocket

Connect to `/api/sync/socket` and authenticate with the first message within
ten seconds (the token never appears in URLs or logs):

```
→ { "type": "auth", "token": "<access token>" }
← { "type": "auth_ok" }
→ { "type": "subscribe", "lists": ["<listId>", …], "plan": true }
← { "type": "subscribed", "topics": ["list:<id>", "plan:<householdId>"] }
```

Subscriptions are membership-checked; ids the user cannot access are silently
skipped. `{ "type": "ping" }` answers `{ "type": "pong" }`.

Events arrive as `{ "type": "event", "topic": "…", "event": { "type": "…",
"data": … } }`:

| Topic                | Event types                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list:<id>`          | `entry.created`, `entry.updated`, `entry.checked`, `entry.unchecked`, `entry.deleted`, `list.updated`, `list.deleted`, `member.added`, `member.removed` |
| `plan:<householdId>` | `plan.entry.created`, `plan.entry.updated`, `plan.entry.deleted`, `slot.created`, `slot.updated`, `slot.deleted`                                        |

A member removed from a list receives `{ "type": "evicted", "topic": … }` and
stops receiving that topic immediately. Access tokens are verified only at
connection time; since they are short-lived, a revoked account loses its feed
at the next reconnect at the latest.
