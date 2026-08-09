# E2E run — milestone 10 (full flow with simulated humans)

- result: PASS
- started: 2026-08-09T12:05:35.073Z, duration 309.2s
- stack: orchestrator https://orchestrator-production-ef93.up.railway.app, frontend https://frontend-production-8ae0d.up.railway.app, k8s agent pods (goose + z-ai/glm-5.2)
- order id: 20a4475c-dd06-490c-bd60-da7f24a5783e
- announcement permalink: https://rain-hackathon-sand.slack.com/archives/C0BNXRJV3AS/p1786277170666599 (channel #eats, ts 1786277170.666599)
- rain card id: 8b07a625-ba3f-4116-b2dc-159933037727
- scenario: admin /begin-order 2 participants, $40, McDonald's, 3m timer; A = full conversational flow (browse -> suggestion -> over-budget pushback -> settle -> confirm -> modify-after-confirm), B = lagger (never confirms -> timer path, then modifies during grace)
- fallbacks used: none — every human action went through the agent DM conversation

## State progression (first observed, seconds since /begin-order)

- COLLECTING: t=0.1s (via ws)
- GRACE: t=179.8s (via ws)
- MINTING: t=298.6s (via ws)
- SUBMITTING: t=302.3s (via ws)
- DECLINED_PROOF_CAPTURED: t=304.3s (via ws)
- CLOSED: t=304.3s (via ws)

Announcement-observed states: {"COLLECTING":2.2,"GRACE":181.4,"MINTING":300.1,"SUBMITTING":304.2,"CLOSED":308.2}
Grace modify: {"t":187.6,"path":"conversation","stateAtModify":"GRACE","graceDeadlineAtEntry":"2026-08-09T12:11:11.026907Z","graceDeadlineAfter":"2026-08-09T12:11:11.026907Z"}
Websocket snapshots captured: 12

## Assertions

- PASS orchestrator healthz — ok; database ping: succeeded

- PASS fair share split $20/$20 — 2000/2000
- PASS A received agent greeting
- PASS A got a menu suggestion with real prices — Here's a tasty lineup under $10! :tada:

**Combo Meals:**
- :hamburger: **2 Cheeseburger Meal** — $6.19
- :chicken: **Crispy Chicken Sandwich Meal** — $7.99

**Beverages:**
- :cup_with_straw: **Coke®** — $1.59
- :beverage_box: **Minute Maid® Orange Juice** — $2.29
- :glass_of_milk: **Chocolate Milk*
- PASS A got over-budget pushback from the agent — Big Mac Meal is in the cart! :white_check_mark: ($10.33, leaving you $9.67)

Now, about the **20 French Fries** — that would be 20 × $2.19 = **$43.80**, which is way over your remaining $9.67. With your current budget, you could fit up to **4 orders of fries** ($8.76).

Did you mean a specific numbe
- PASS A is confirmed
- PASS modifying after confirm re-opened A
- PASS order closed via mint -> submit -> decline path — CLOSED
- PASS both simulated humans received agent greetings
- PASS A confirmed via DM conversation — conversation
- PASS state progression COLLECTING->GRACE->MINTING->SUBMITTING->CLOSED observed — {"COLLECTING":{"t":0.1,"source":"ws"},"GRACE":{"t":179.8,"source":"ws"},"MINTING":{"t":298.6,"source":"ws"},"SUBMITTING":{"t":302.3,"source":"ws"},"DECLINED_PROOF_CAPTURED":{"t":304.3,"source":"ws"},"CLOSED":{"t":304.3,"source":"ws"}}
- PASS announcement progressed COLLECTING->GRACE — {"COLLECTING":2.2,"GRACE":181.4,"MINTING":300.1,"SUBMITTING":304.2,"CLOSED":308.2}
- PASS announcement final text shows closed + decline-proof line — Group Grub order
*Restaurant*
McDonald's
*Budget*
$40.00
*Participants*
:white_check_mark: <@U0BNZQ7KR34>
:hourglass_flowing_sand: <@U0BPU5GU6KS>
*Status:* CLOSED
:credit_card: Card minted → :motor_scooter: order submitted → :x: declined (by design) — see proof page
Proof: <https://orchestrator-prod
- PASS GRACE entered at timer expiry (not all-confirmed) — t=180.9s
- PASS B still unconfirmed at GRACE entry (timer path proven)
- PASS cart modified during grace period — {"t":187.6,"path":"conversation","stateAtModify":"GRACE","graceDeadlineAtEntry":"2026-08-09T12:11:11.026907Z","graceDeadlineAfter":"2026-08-09T12:11:11.026907Z"}
- PASS grace modification did not extend the grace deadline
- PASS proof endpoint reports CLOSED
- PASS every cart <= share
- PASS order total within $300 cap — total=1570
- PASS B never confirmed
- PASS Rain card id recorded — 8b07a625-ba3f-4116-b2dc-159933037727
- PASS DoorDash delivery id recorded — gg-20a4475c-dd06-490c-bd60-da7f24a5783e
- PASS declined_at recorded
- PASS card_attempts has DoorDash + Rain decline evidence
- PASS payment path recorded — rain_simulated_authorization
- PASS minted card exists in Rain sandbox — 8b07a625-ba3f-4116-b2dc-159933037727
- PASS Rain card limit = 1.2x order total (1570 -> 1884) — got 1884
- PASS past-orders API lists the run (frontend past-orders page data)
- PASS frontend serves the app (past-orders page reachable)
- PASS websocket emitted snapshots during the run — 12 snapshots
- PASS websocket emitted cart events
- PASS websocket emitted the GRACE transition

## Simulated-human transcript (Slack DMs)

- [t=10.1s] agent->A: Hey there! :wave: Welcome to the McDonald's group order — you've got **$20.00** to spend. Here are some tasty options to get you started:

- :hamburger: **2 Cheeseburger Meal** — $6.19
- :poultry_leg: **10 Piece McNuggets Meal** — $9.09
- :fries: **French Fries** — $2.19
- :cup_with_straw: **Coke®** — $1.59

Just tell me what you'd like to add, or ask me to search for something specific!
- [t=10.2s] A: Hey! What's on the menu? Can you suggest something tasty under $10?
- [t=11s] agent->B: Hey there! :wave: Welcome to the McDonald's group order — your budget share is **$20.00**. Here are a few tasty options to get you started:

- :hamburger: **2 Cheeseburger Meal** — $6.19
- :fries: **French Fries** — $2.19
- :cup_with_straw: **Coke®** — $1.59
- :poultry_leg: **10 Piece McNuggets Meal** — $9.09

Just let me know what you'd like to add, or ask me to search for something specific!
- [t=11s] B: Hi! What can I get here?
- [t=19.5s] agent->A: Here's a tasty lineup under $10! :tada:

**Combo Meals:**
- :hamburger: **2 Cheeseburger Meal** — $6.19
- :chicken: **Crispy Chicken Sandwich Meal** — $7.99

**Beverages:**
- :cup_with_straw: **Coke®** — $1.59
- :beverage_box: **Minute Maid® Orange Juice** — $2.29
- :glass_of_milk: **Chocolate Milk** — $1.79

**Sides:**
- :fries: **French Fries** — $2.19 *(from earlier)*

There are 55 items under $10 total! Want me to search for something specific like a burger, salad, or dessert? Just say the word and I'll add it to your cart! :shopping_trolley:
- [t=19.6s] A: Great — add a Big Mac Meal and 20 French Fries please
- [t=20.3s] agent->B: Here's what's on the menu at McDonald's! :fries:

**:hamburger: Combo Meals**
- 2 Cheeseburger Meal — $6.19
- Triple Cheeseburger Meal — $6.69
- Hot and Spicy McChicken Meal — $5.69
- Quarter Pounder with Cheese Meal — $7.89
- Homestyle Burger Meal — $8.39
- Crispy Chicken Sandwich Meal — $7.99
- Big Mac Meal — $10.33
- Bacon Quarter Pounder with Cheese Meal — $10.79
- Double Quarter Pounder with Cheese Meal — $11.88
- Double Bacon Quarter Pounder with Cheese Meal — $12.09

**:fries: Sides**
- French Fries — $2.19

**:cup_with_straw: Beverages**
- Coke®, Coke Zero®, Diet Coke®, Dr Pepper®, Sprite®, Fanta Orange, Powerade®, Hi-C®, Sweet/Unsweetened Iced Tea — $1.59 each
- Chocolate Milk / Milk — $1.79
- Minute Maid® Orange Juice — $2.29

**:coffee: McCafé**
- Caramel Cappuccino — $2.50

Your budget is **$20.00**. Want me to search for something specific (like desserts, breakfast, or a particular item)? Or just tell me what you'd like to add! :blush:
- [t=20.4s] B: Add a Coke for me please
- [t=26.7s] agent->B: Added! :cup_with_straw: You've got a **Coke® ($1.59)** in your cart. You still have **$18.41** left — want to add anything else?
- [t=35.1s] agent->A: Big Mac Meal is in the cart! :white_check_mark: ($10.33, leaving you $9.67)

Now, about the **20 French Fries** — that would be 20 × $2.19 = **$43.80**, which is way over your remaining $9.67. With your current budget, you could fit up to **4 orders of fries** ($8.76).

Did you mean a specific number, or maybe a different size? Let me know how many fries you'd like and I'll add them! :fries:
- [t=35.2s] A: Ha, ok — just the Big Mac Meal then, nothing else
- [t=46s] agent->A: Here's your order:

| Item | Price |
|------|-------|
| :hamburger: Big Mac Meal | $10.33 |
| **Total** | **$10.33** |

Remaining budget: $9.67

Looks good? Just reply **yes** to confirm and submit! :white_check_mark:
- [t=46.3s] A: Yes, that looks perfect — please confirm my order
- [t=52.5s] agent->A: Your order is confirmed and submitted! :tada::hamburger:

Just one Big Mac Meal for $10.33. You can still change your mind and add or remove items anytime before the group order closes — just let me know! Enjoy your meal! :fries:
- [t=52.7s] A: wait — actually add a Coke to my order too
- [t=58.9s] A: ok yes, confirm it again
- [t=181.4s] B: Actually, can you add French Fries to my order too?

## Proof JSON (GET /api/orders/20a4475c-dd06-490c-bd60-da7f24a5783e/proof)

```json
{
  "budget_cents": 4000,
  "card_attempt": {
    "amount_cents": 1570,
    "created_at": "2026-08-09T12:11:11.07189Z",
    "declined_at": "2026-08-09T12:11:16.987289Z",
    "doordash_delivery_id": "gg-20a4475c-dd06-490c-bd60-da7f24a5783e",
    "doordash_request": {
      "quote": {
        "url": "https://openapi.doordash.com/drive/v2/quotes",
        "body": {
          "items": [
            {
              "name": "Big Mac Meal",
              "price": 1033,
              "quantity": 1
            },
            {
              "name": "Coke®",
              "price": 159,
              "quantity": 2
            },
            {
              "name": "French Fries",
              "price": 219,
              "quantity": 1
            }
          ],
          "order_value": 1570,
          "pickup_address": "901 Market Street 6th Floor San Francisco, CA 94103",
          "dropoff_address": "1 Hackathon Way, San Francisco, CA 94105",
          "contactless_dropoff": true,
          "pickup_phone_number": "+16505555555",
          "dropoff_instructions": "Group Grub sandbox order",
          "dropoff_phone_number": "+16505555555",
          "external_delivery_id": "gg-20a4475c-dd06-490c-bd60-da7f24a5783e",
          "pickup_business_name": "McDonald's",
          "action_if_undeliverable": "dispose"
        },
        "note": "retried with fallback pickup after distance_too_long",
        "method": "POST"
      },
      "accept": {
        "url": "https://openapi.doordash.com/drive/v2/quotes/gg-20a4475c-dd06-490c-bd60-da7f24a5783e/accept",
        "body": {
          "order_value": 1570
        },
        "method": "POST"
      }
    },
    "doordash_response": {
      "payment": {
        "path": "rain_simulated_authorization",
        "request": {
          "url": "https://api-dev.raincards.xyz/v1/simulate/transactions/authorize",
          "body": {
            "amount": 1570,
            "cardId": "8b07a625-ba3f-4116-b2dc-159933037727",
            "currency": "USD",
            "merchantName": "DoorDash - McDonald's",
            "declineReason": "account_credit_limit_exceeded",
            "merchantCategoryCode": "5812"
          },
          "method": "POST"
        },
        "response": {
          "attempts": [
            {
              "at": "2026-08-09T12:11:16.810780444Z",
              "body": {
                "status": "declined",
                "transactionId": "e447823b-30f4-49cb-9f23-6df3ed49a5fa",
                "declinedReason": "account_credit_limit_exceeded"
              },
              "status": 200
            }
          ]
        }
      },
      "payment_note": "Drive sandbox cannot take a raw card payment; the DoorDash charge is simulated as a Rain authorization against the minted card, which declines by design (dummy card).",
      "payment_path": "rain_simulated_authorization",
      "tracking_url": "https://www.doordash.com/orders/drive?urlCode=2c3be45d-be0f-45b3-979a-3aaf2ec8f070",
      "quote_attempts": [
        {
          "at": "2026-08-09T12:11:15.047443277Z",
          "body": {
            "code": "invalid_delivery_parameters",
            "reason": "distance_too_long",
            "message": "Exceeded allowed distance configured for this store between pickup and drop off addresses"
          },
          "status": 422
        },
        {
          "at": "2026-08-09T12:11:15.461327552Z",
          "body": {
            "fee": 975,
            "tax": 0,
            "tip": 0,
            "items": [
              {
                "name": "Big Mac Meal",
                "price": 1033,
                "quantity": 1
              },
              {
                "name": "Coke®",
                "price": 159,
                "quantity": 2
              },
              {
                "name": "French Fries",
                "price": 219,
                "quantity": 1
              }
            ],
            "currency": "USD",
            "updated_at": "2026-08-09T12:11:16.189536040Z",
            "order_value": 1570,
            "tracking_url": "https://track.doordash.com/order/bd1c1a84-e0b9-4d8e-b4d3-beae12a26acb/track",
            "fee_components": [],
            "order_contains": {
              "otc": false,
              "hemp": false,
              "alcohol": false,
              "tobacco": false,
              "pharmacy_items": false,
              "age_restricted_pharmacy_items": false
            },
            "pickup_address": "901 Market St Fl 6th, San Francisco CA 94103-1729, USA",
            "tax_components": [],
            "delivery_status": "quote",
            "dropoff_address": "1 Hackathon Way, San Francisco, CA 94105",
            "dropoff_options": {
              "signature": "none",
              "catering_setup": "none",
              "id_verification": "none",
              "proof_of_delivery": "none"
            },
            "dropoff_location": {
              "lat": 37.7892,
              "lng": -122.3951
            },
            "contactless_dropoff": true,
            "pickup_phone_number": "+16505555555",
            "dropoff_instructions": "Group Grub sandbox order",
            "dropoff_phone_number": "+16505555555",
            "external_delivery_id": "gg-20a4475c-dd06-490c-bd60-da7f24a5783e",
            "pickup_business_name": "McDonald's",
            "pickup_time_estimated": "2026-08-09T12:27:20Z",
            "dropoff_time_estimated": "2026-08-09T12:53:45Z",
            "action_if_undeliverable": "dispose",
            "dropoff_cash_on_delivery": 0,
            "pickup_external_store_id": "f58b0426-366b-4151-9617-2cc8570749a7",
            "dropoff_address_components": {
              "city": "",
              "state": "",
              "country": "United States",
              "zip_code": "",
              "sub_premise": "",
              "street_address": ""
            },
            "dropoff_requires_signature": false,
            "pickup_external_business_id": "default"
          },
          "status": 200
        }
      ],
      "accept_attempts": [
        {
          "at": "2026-08-09T12:11:16.29567506Z",
          "body": {
            "fee": 975,
            "tax": 0,
            "tip": 0,
            "items": [
              {
                "name": "Big Mac Meal",
                "price": 1033,
                "quantity": 1
              },
              {
                "name": "Coke®",
                "price": 159,
                "quantity": 2
              },
              {
                "name": "French Fries",
                "price": 219,
                "quantity": 1
              }
            ],
            "currency": "USD",
            "updated_at": "2026-08-09T12:11:16.606501Z",
            "order_value": 1570,
            "tracking_url": "https://www.doordash.com/orders/drive?urlCode=2c3be45d-be0f-45b3-979a-3aaf2ec8f070",
            "fee_components": [],
            "order_contains": {
              "otc": false,
              "hemp": false,
              "alcohol": false,
              "tobacco": false,
              "pharmacy_items": false,
              "age_restricted_pharmacy_items": false
            },
            "pickup_address": "901 Market St Fl 6th, San Francisco CA 94103-1729, USA",
            "tax_components": [],
            "delivery_status": "created",
            "dropoff_address": "1 Hackathon Way, San Francisco, CA 94105",
            "dropoff_location": {
              "lat": 37.7892,
              "lng": -122.3951
            },
            "support_reference": "2919667539",
            "contactless_dropoff": true,
            "pickup_phone_number": "+16505555555",
            "dropoff_instructions": "Group Grub sandbox order",
            "dropoff_phone_number": "+16505555555",
            "external_delivery_id": "gg-20a4475c-dd06-490c-bd60-da7f24a5783e",
            "pickup_business_name": "McDonald's",
            "pickup_time_estimated": "2026-08-09T12:27:20Z",
            "dropoff_time_estimated": "2026-08-09T12:53:45Z",
            "action_if_undeliverable": "dispose",
            "dropoff_cash_on_delivery": 0,
            "pickup_external_store_id": "f58b0426-366b-4151-9617-2cc8570749a7",
            "dropoff_requires_signature": false,
            "pickup_external_business_id": "default"
          },
          "status": 200
        }
      ],
      "delivery_status": "created"
    },
    "id": 5,
    "payment_path": "rain_simulated_authorization",
    "rain_card_id": "8b07a625-ba3f-4116-b2dc-159933037727",
    "rain_request": {
      "url": "https://api-dev.raincards.xyz/v1/issuing/users/7209c48b-edc1-4d6d-a872-3c3418f2baa9/cards/scoped",
      "body": {
        "expiresAt": "2026-09-08T12:11:11Z",
        "allowedMccs": [
          "5411",
          "5812",
          "5814"
        ],
        "amountInUSDCents": 1570
      },
      "method": "POST"
    },
    "rain_response": {
      "attempts": [
        {
          "at": "2026-08-09T12:11:11.07284903Z",
          "body": {
            "id": "8b07a625-ba3f-4116-b2dc-159933037727",
            "last4": "5986",
            "status": "active",
            "encryptedCvc": {
              "iv": "cQAYnaaZmKY8W7oX8Eri8A==",
              "data": "ptPx5al4a3KvcLpsqCsh13+RWg=="
            },
            "encryptedPan": {
              "iv": "kutwKH3c0cM7KRB+Xit6CQ==",
              "data": "OAtERFCPZbdM7aI/zJOPHWk7RsPSIymwV7bQ2wtFAjI="
            },
            "expirationYear": "2031",
            "expirationMonth": "1"
          },
          "status": 200
        }
      ]
    }
  },
  "collateral_chain": "",
  "collateral_contract_id": "95786875-118c-47fe-a49c-b3b1430d2195",
  "created_at": "2026-08-09T12:06:10.605139Z",
  "order_id": "20a4475c-dd06-490c-bd60-da7f24a5783e",
  "participants": [
    {
      "cart": [
        {
          "name": "Big Mac Meal",
          "price_cents": 1033,
          "quantity": 1
        },
        {
          "name": "Coke®",
          "price_cents": 159,
          "quantity": 1
        }
      ],
      "confirmed": true,
      "share_cents": 2000,
      "slack_user_id": "U0BNZQ7KR34"
    },
    {
      "cart": [
        {
          "name": "Coke®",
          "price_cents": 159,
          "quantity": 1
        },
        {
          "name": "French Fries",
          "price_cents": 219,
          "quantity": 1
        }
      ],
      "confirmed": false,
      "share_cents": 2000,
      "slack_user_id": "U0BPU5GU6KS"
    }
  ],
  "restaurant": "McDonald's",
  "state": "CLOSED",
  "total_cents": 1570,
  "updated_at": "2026-08-09T12:11:17.002337Z"
}
```
