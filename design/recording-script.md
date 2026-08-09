# Rain Check — demo recording script

**3 minutes hard. Carson records from his machine. One take if possible.**

---

## SETUP (do this before hitting record)

**Screen layout, side by side, one window each:**
- **LEFT ~40%** — Slack, on the channel where the announcement posts. Have one participant DM
  open in a second Slack view if you can, or be ready to switch to it once.
- **RIGHT ~60%** — browser on the live dashboard (`#/` route), already connected to the order.

The dashboard sheet is a wide two-column layout. If it feels cramped at 60% width, set browser
zoom to **80%** — do this BEFORE recording, not during.

**Have ready but off-screen:** the past-orders page (`#/orders`) with a closed order's proof view,
as the fallback if the live run stalls.

**Checklist before record:**
- [ ] Restaurant is **McDonald's**. The two Burger King attempts both FAILED this morning.
- [ ] Participants are **Demo User** and **Alex Wu** — those are the only humans in the workspace.
      Carson is not in it. Don't say a name that won't appear on screen.
- [ ] Budget **$40**, timer **3m**.
- [ ] Notifications silenced, other tabs closed, no personal DMs visible in the sidebar.
- [ ] The dashboard is already open and showing a live connection before you start the order.

**The one thing that will kill the take:** an order with an empty cart FAILS at close — a 0-cent
card 400s on Rain's authorize. **Someone must add items before the timer ends.** Both failures this
morning were empty carts, not bugs.

---

## THE RECORDING — 3:00

### 0:00–0:18 · open on Slack, dashboard visible beside it
**ACTION:** the announcement is up, timer running, dashboard shows the order.

> "A Rain scoped card is a one-agent object. One merchant, one amount, typed in before anything
> happens. We ran several agents against a single hard cap where they reallocate budget between
> themselves while the order is open — so the card gets minted for a number nobody knew three
> minutes earlier."

### 0:18–0:50 · the DMs
**ACTION:** switch to a participant DM. Add an item through the agent. Switch back — the
announcement has updated in place and the dashboard number has moved.

> "Each participant gets their own agent, running as a pod per participant on Kubernetes. Both
> surfaces are reading the same orchestrator — Slack and the dashboard never talk to each other."

**Point at the dashboard as the number changes.** That moment is the proof the whole thing is live,
and it is the cheapest credibility in the video.

### 0:50–1:20 · the trade — this is the spine, do not rush it
**ACTION:** one participant goes over their share. Their agent asks the group. The other releases
budget. Coins/adjustment column updates on the sheet.

> "Over your share, your agent doesn't escalate to an admin — it asks the group, and whoever has
> slack releases budget. The ledger is a single writer over an append-only log, and the invariant
> — every participant's spend plus the unallocated pool equals the cap — is re-asserted on every
> commit, in integer cents. Budget moved between two agents with no human in the authorization
> path."

### 1:20–1:45 · close and mint
**ACTION:** timer expires, grace, order closes. The card appears on the sheet with its real rules.

> "Order closes. The checkout agent mints one scoped virtual card against Rain's Agent Control
> Layer for exactly the settled total, and the session token for scoped issuance is
> client-generated RSA-OAEP against Rain's published key, not desk-issued. It comes back with
> encrypted PAN and CVC, and a lifetime limit that's Rain's 1.2× ceiling on what we asked for."

### 1:45–2:00 · the honest boundary — say it at normal speed, do not apologise
> "Two things you'd catch anyway. This card enforces its merchant category and does not enforce
> its amount — we requested seventy-three forty on a test card and it authorized eighty-eight-oh-
> nine — so the total here is our ledger's, committed before we call issue. And this is api-dev,
> so nothing reaches a card network."

### 2:00–2:30 · the guardrail beat
**ACTION:** show the authorization tape. The off-category decline, then the real charge.

> "Same amount, wrong merchant category. Rain declines it: `scoped_card_mcc_not_allowed`. Our
> request body has an empty decline-reason field — that's Rain's enforcement, not ours. Now the
> real one. Authorized, settled, and the card flips to canceled: retired by its first successful
> authorization."

**ORDER MATTERS: decline first, charge second.** A success consumes the card; a decline doesn't.

### 2:30–2:45 · reconciliation
**ACTION:** the spendingPower row on the sheet.

> "That's Rain's own balances endpoint. Spending power drops by exactly the total. Then an item
> falls through, we run an authorization reversal, and the hold releases to the cent."

### 2:45–3:00 · close
> "One cap, several agents that negotiated for it, and a credential that didn't exist until they
> agreed. That's the part a scoped card can't express on its own."

**Stop.** No thank-you card, no logo outro, no "we'd love to work with you."

---

## DO NOT SAY

- **Monad.** There is no Monad in this build. If asked later: "We didn't use it — Rain's sandbox
  settles collateral on Sepolia, Fuji, Solana Devnet, Amoy and Base Sepolia, and Monad isn't an
  option there. We'd rather tell you we didn't use it than fake a tx hash."
- **"The card paid DoorDash."** Drive sandbox takes no card payment. The card leg and the delivery
  leg are separate steps the state machine sequences.
- **"Lantern Order" or "Moon Palace Burgers."** It's Rain Check, at McDonald's.
- Any claim that Rain enforces the dollar amount. It doesn't.

---

## IF SOMETHING BREAKS

Say the fallback out loud rather than skipping silently. An announced fallback costs nothing.

1. **Agent DM hangs** → "the agent's thinking, here's the same step from an earlier run" and cut to
   the past-orders proof view.
2. **Order FAILS at close** → almost certainly an empty cart. Don't debug on camera. Cut, add items,
   re-run. It takes ~5 minutes.
3. **Dashboard doesn't update** → keep going on Slack alone and show the proof view at the end.
   Don't draw attention to a frozen panel.
4. **Whole live run dies** → open a CLOSED order's proof view and narrate the same beats off it.
   Every uuid, decline string and balance on that page is real.

**Never cut:** the mint with real read-back rules, the MCC decline with Rain's own string, and the
balances delta.
