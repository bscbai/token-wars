"""Token Wars — 示例参赛 bot（Python）

连接 /bot 命名空间 → 自动接受邀请 → 每 tick 返回一个动作。
策略与 Node 示例一致：近身攻击 / 低血量开盾 / 否则 BFS 绕障逼近 / 看不见敌人就 idle。

用法：
    pip install -r requirements.txt
    BOT_URL=http://localhost:3000 BOT_TOKEN=<botToken> python bot.py

botToken 获取见 ../sample-bot-node/README.md 或 ../../docs/bot-protocol.md。
把 decide() 换成 LLM 调用即可接入真实模型（注意 500ms/tick、单场 100k token）。
"""

import os
import sys
from collections import deque

import socketio

URL = os.environ.get("BOT_URL", "http://localhost:3000")
TOKEN = os.environ.get("BOT_TOKEN")
PROTOCOL_VERSION = 1

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


def bfs_first_step(frm, to):
    """BFS 最短路的第一步；无可达路径返回 None。敌人所在格视为可达目标。"""
    if map_info is None:
        return None
    obstacles = {(ox, oy) for ox, oy in map_info["obstacles"]}
    start = (frm["x"], frm["y"])
    goal = (to["x"], to["y"])

    prev = {start: None}
    queue = deque([start])
    while queue:
        cur = queue.popleft()
        if cur == goal:
            node = cur
            parent = prev[node]
            if parent is None:
                return None
            while prev[parent] is not None:
                node = parent
                parent = prev[node]
            return {"x": node[0], "y": node[1]}

        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = cur[0] + dx, cur[1] + dy
            if nx < 0 or ny < 0 or nx >= map_info["width"] or ny >= map_info["height"]:
                continue
            if (nx, ny) in obstacles and (nx, ny) != goal:
                continue
            if (nx, ny) in prev:
                continue
            prev[(nx, ny)] = cur
            queue.append((nx, ny))
    return None


def decide(state):
    you, enemy = state["you"], state.get("enemy")
    if not enemy or not enemy.get("visible"):
        return {"type": "idle"}

    # 1) 进入攻击距离：能打就打，冷却中原地等待（继续靠近只会贴脸）
    if manhattan(you, enemy) <= 2:
        return {"type": "attack"} if skill_ready(you, "basic_attack") else {"type": "idle"}

    # 2) 低血量开盾
    if (
        you["hp"] / you["maxHp"] < 0.35
        and not you.get("shieldActive")
        and skill_ready(you, "shield")
    ):
        return {"type": "shield"}

    # 3) 绕障逼近（贪心会被墙卡死，BFS 不会）
    step = bfs_first_step(you, enemy)
    if step and walkable(step["x"], step["y"]):
        return {"type": "move", "x": step["x"], "y": step["y"]}

    return {"type": "idle"}


if __name__ == "__main__":
    if not TOKEN:
        sys.exit("Missing BOT_TOKEN env var. See README in this folder.")
    sio.connect(
        f"{URL}/bot",
        socketio_path="socket.io",
        auth={"botToken": TOKEN},
        transports=["websocket"],
    )
    sio.wait()
