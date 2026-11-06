"""Token Wars — 示例参赛 bot（Python）

连接 /bot 命名空间 → 自动接受邀请 → 每 tick 返回一个动作。
策略与 Node 示例一致：近身攻击 / 低血量开盾 / 否则逼近 / 看不见敌人就 idle。

用法：
    pip install -r requirements.txt
    BOT_URL=http://localhost:3000 BOT_TOKEN=<botToken> python bot.py

botToken 获取见 ../sample-bot-node/README.md 或 ../../docs/bot-protocol.md。
把 decide() 换成 LLM 调用即可接入真实模型（注意 500ms/tick、单场 100k token）。
"""

import os
import sys

import socketio

URL = os.environ.get("BOT_URL", "http://localhost:3000")
TOKEN = os.environ.get("BOT_TOKEN")
PROTOCOL_VERSION = 1

if not TOKEN:
    sys.exit("Missing BOT_TOKEN env var. See README in this folder.")

sio = socketio.Client()
map_info = None  # invite 携带的地图（width/height/obstacles），state 不含地图


@sio.event
def connect():
    print(f"[bot] connected as {sio.sid}; waiting for match invite...")


@sio.event
def connect_error(err):
    print(f"[bot] connection failed: {err}")


@sio.on("bot:match_invite")
def on_invite(invite):
    global map_info
    map_info = invite["map"]
    print(
        f"[bot] invited to {invite['matchId']} as {invite['role']} on "
        f"{map_info['width']}x{map_info['height']} "
        f"(deadline={invite['decisionDeadlineMs']}ms, budget={invite['tokenBudget']})"
    )
    sio.emit(
        "bot:match_accept",
        {"protocolVersion": PROTOCOL_VERSION, "matchId": invite["matchId"]},
    )


@sio.on("bot:state")
def on_state(state):
    action = decide(state)
    sio.emit(
        "bot:action",
        {
            "protocolVersion": PROTOCOL_VERSION,
            "matchId": state["matchId"],
            "tick": state["tick"],
            "action": action,
            "tokensUsed": 0,  # 自报本决策 token 消耗（LLM 场景填实际用量）
        },
    )


@sio.on("bot:match_end")
def on_end(msg):
    print(f"[bot] match {msg['matchId']} -> {msg['result']}", msg.get("stats"))


@sio.on("bot:error")
def on_error(msg):
    print("[bot] server error:", msg)


@sio.event
def disconnect():
    print("[bot] disconnected")


# --- 决策逻辑 ---------------------------------------------------------------


def manhattan(a, b):
    return abs(a["x"] - b["x"]) + abs(a["y"] - b["y"])


def walkable(x, y):
    if map_info is None:
        return True
    if x < 0 or y < 0 or x >= map_info["width"] or y >= map_info["height"]:
        return False
    return not any(ox == x and oy == y for ox, oy in map_info["obstacles"])


def skill_ready(you, skill_id):
    for s in you["skills"]:
        if s["id"] == skill_id:
            return s["cooldownRemaining"] == 0
    return True


def decide(state):
    you, enemy = state["you"], state.get("enemy")
    if not enemy or not enemy.get("visible"):
        return {"type": "idle"}

    # 1) 近身攻击（距离 ≤ 2 且冷却就绪）
    if manhattan(you, enemy) <= 2 and skill_ready(you, "basic_attack"):
        return {"type": "attack"}

    # 2) 低血量开盾
    if (
        you["hp"] / you["maxHp"] < 0.35
        and not you.get("shieldActive")
        and skill_ready(you, "shield")
    ):
        return {"type": "shield"}

    # 3) 逼近：四邻域选可通行且距敌最近的一格
    best = None
    for p in (
        {"x": you["x"] + 1, "y": you["y"]},
        {"x": you["x"] - 1, "y": you["y"]},
        {"x": you["x"], "y": you["y"] + 1},
        {"x": you["x"], "y": you["y"] - 1},
    ):
        if not walkable(p["x"], p["y"]):
            continue
        if best is None or manhattan(p, enemy) < manhattan(best, enemy):
            best = p

    if best and manhattan(best, enemy) < manhattan(you, enemy):
        return {"type": "move", "x": best["x"], "y": best["y"]}

    return {"type": "idle"}


if __name__ == "__main__":
    sio.connect(
        f"{URL}/bot",
        socketio_path="socket.io",
        auth={"botToken": TOKEN},
        transports=["websocket"],
    )
    sio.wait()
