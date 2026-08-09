#!/usr/bin/env python3
"""MCP stdio server exposing Group Grub orchestrator tools to goose.

Zero-dependency JSON-RPC 2.0 over newline-delimited stdio. Config comes from
/tmp/agent-env.json written by bridge.py (avoids relying on env propagation
through goose's extension launcher).
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

CONFIG_PATH = "/tmp/agent-env.json"


def load_config():
    with open(CONFIG_PATH) as handle:
        return json.load(handle)


CFG = load_config()
ORCH = CFG["ORCHESTRATOR_URL"].rstrip("/")
ORDER_ID = CFG["ORDER_ID"]
UID = CFG["PARTICIPANT_SLACK_ID"]
RESTAURANT = CFG.get("RESTAURANT", "")


def http(method, path, body=None):
    request = urllib.request.Request(
        ORCH + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode().strip()
        raise RuntimeError(f"orchestrator returned {error.code}: {detail}")


def participant(suffix):
    return f"/internal/orders/{ORDER_ID}/participants/{UID}{suffix}"


def fetch_menu():
    query = urllib.parse.quote(RESTAURANT)
    data = http("GET", f"/internal/menu?restaurant={query}")
    return data.get("restaurant", RESTAURANT), data.get("items", [])


def format_item(item):
    return f"#{item.get('id', 0)} {item['name']} - ${item['price_cents'] / 100:.2f} ({item.get('category', 'misc')})"


def tool_list_menu(arguments):
    max_price = arguments.get("max_price_cents")
    limit = int(arguments.get("limit", 30))
    restaurant, items = fetch_menu()
    if max_price is not None:
        items = [item for item in items if item["price_cents"] <= int(max_price)]
    total = len(items)
    lines = [format_item(item) for item in items[:limit]]
    header = f"Menu for {restaurant}: {total} matching items"
    if total > limit:
        header += f" (showing first {limit}; use search_menu to narrow down)"
    return header + "\n" + "\n".join(lines)


def tool_search_menu(arguments):
    query = str(arguments.get("query", "")).lower()
    if not query:
        return "query is required"
    max_price = arguments.get("max_price_cents")
    restaurant, items = fetch_menu()
    matches = [item for item in items if query in item["name"].lower() or query in item.get("description", "").lower()]
    if max_price is not None:
        matches = [item for item in matches if item["price_cents"] <= int(max_price)]
    if not matches:
        return f"No items matching {query!r} at {restaurant}."
    lines = [format_item(item) for item in matches[:20]]
    suffix = "" if len(matches) <= 20 else f"\n...and {len(matches) - 20} more matches"
    return f"{len(matches)} match(es) at {restaurant}:\n" + "\n".join(lines) + suffix


def tool_get_budget(_arguments):
    budget = http("GET", participant("/budget"))
    return (
        f"Budget share: ${budget['share_cents'] / 100:.2f}. "
        f"Cart total: ${budget['cart_total_cents'] / 100:.2f}. "
        f"Remaining: ${budget['remaining_cents'] / 100:.2f}."
    )


def tool_get_cart(_arguments):
    cart = http("GET", participant("/cart"))
    items = cart.get("items", [])
    if not items:
        return "Cart is empty."
    lines = [f"{item['quantity']}x {item['name']} - ${item['price_cents'] * item['quantity'] / 100:.2f}" for item in items]
    return f"Cart (total ${cart['total_cents'] / 100:.2f}):\n" + "\n".join(lines)


def tool_add_item(arguments):
    quantity = int(arguments.get("quantity", 1))
    body = {"quantity": quantity}
    item_id = int(arguments.get("menu_item_id", 0) or 0)
    if item_id > 0:
        body["menu_item_id"] = item_id
    else:
        name = str(arguments.get("name", "")).strip()
        if not name:
            return "Provide menu_item_id (preferred, from search_menu/list_menu) or name + price_cents."
        body["name"] = name
        body["price_cents"] = int(arguments.get("price_cents", 0))
    http("POST", participant("/cart"), body)
    return "Added. " + tool_get_cart({}) + " " + tool_get_budget({})


def tool_remove_item(arguments):
    name = str(arguments.get("name", "")).strip()
    if not name:
        return "name is required (exact item name as shown in the cart)"
    http("POST", participant("/cart/remove"), {"name": name})
    return "Removed. " + tool_get_cart({}) + " " + tool_get_budget({})


def tool_propose_confirmation(_arguments):
    cart = http("GET", participant("/cart"))
    if not cart.get("items"):
        return "The cart is empty; add items before asking for confirmation."
    summary = tool_get_cart({})
    budget = tool_get_budget({})
    return (
        "Present this proposal to the user and ask them to reply 'yes' to submit, "
        "or tell you what to change. Do NOT call submit_confirmation until the user "
        f"explicitly agrees.\n{summary}\n{budget}"
    )


def tool_submit_confirmation(_arguments):
    http("POST", participant("/confirm"))
    return (
        "Order confirmed and submitted to the group order. Tell the user they can "
        "still change their mind and modify the cart until the group order closes."
    )


TOOLS = [
    {
        "name": "list_menu",
        "description": "List orderable menu items for this order's restaurant. Optionally filter by max price.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "max_price_cents": {"type": "integer", "description": "Only show items at or under this price in cents"},
                "limit": {"type": "integer", "description": "Max items to return (default 30)"},
            },
        },
    },
    {
        "name": "search_menu",
        "description": "Search menu items by name/description substring (e.g. 'fries', 'burger').",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "max_price_cents": {"type": "integer"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_budget",
        "description": "Get the participant's budget share, current cart total, and remaining amount.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_cart",
        "description": "Get the participant's current cart items and total.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "add_item",
        "description": "Add an item to the cart. Prefer menu_item_id from list_menu/search_menu so the exact price is used. The server rejects adds that exceed the budget share.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "menu_item_id": {"type": "integer", "description": "Item id from list_menu/search_menu"},
                "name": {"type": "string", "description": "Item name (only if no menu_item_id)"},
                "price_cents": {"type": "integer", "description": "Price in cents (only with name)"},
                "quantity": {"type": "integer", "description": "Quantity (default 1)"},
            },
        },
    },
    {
        "name": "remove_item",
        "description": "Remove an item from the cart by its exact name as shown in get_cart.",
        "inputSchema": {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        },
    },
    {
        "name": "propose_confirmation",
        "description": "Build the order proposal to show the user before they confirm. Always ask for an explicit 'yes' afterwards.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "submit_confirmation",
        "description": "Submit the participant's confirmed order. ONLY call after the user explicitly said yes/confirm.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]

HANDLERS = {
    "list_menu": tool_list_menu,
    "search_menu": tool_search_menu,
    "get_budget": tool_get_budget,
    "get_cart": tool_get_cart,
    "add_item": tool_add_item,
    "remove_item": tool_remove_item,
    "propose_confirmation": tool_propose_confirmation,
    "submit_confirmation": tool_submit_confirmation,
}


def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        method = message.get("method")
        message_id = message.get("id")
        if method is None:
            continue
        if method == "initialize":
            params = message.get("params") or {}
            send({
                "jsonrpc": "2.0",
                "id": message_id,
                "result": {
                    "protocolVersion": params.get("protocolVersion", "2024-11-05"),
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "group-grub", "version": "1.0.0"},
                },
            })
        elif method.startswith("notifications/"):
            continue
        elif method == "ping":
            send({"jsonrpc": "2.0", "id": message_id, "result": {}})
        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": message_id, "result": {"tools": TOOLS}})
        elif method == "tools/call":
            params = message.get("params") or {}
            name = params.get("name", "")
            arguments = params.get("arguments") or {}
            handler = HANDLERS.get(name)
            if handler is None:
                send({"jsonrpc": "2.0", "id": message_id, "result": {"content": [{"type": "text", "text": f"unknown tool {name}"}], "isError": True}})
                continue
            try:
                text = handler(arguments)
                send({"jsonrpc": "2.0", "id": message_id, "result": {"content": [{"type": "text", "text": text}]}})
            except Exception as error:  # surface orchestrator errors to the agent
                send({"jsonrpc": "2.0", "id": message_id, "result": {"content": [{"type": "text", "text": f"Error: {error}"}], "isError": True}})
        elif message_id is not None:
            send({"jsonrpc": "2.0", "id": message_id, "error": {"code": -32601, "message": f"method not found: {method}"}})


if __name__ == "__main__":
    main()
