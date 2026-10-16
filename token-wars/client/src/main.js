import { BootScene } from './scenes/BootScene.js';
import { LoginScene } from './scenes/LoginScene.js';
import { LobbyScene } from './scenes/LobbyScene.js';
import { MiningScene } from './scenes/MiningScene.js';
import { DungeonSelectScene } from './scenes/DungeonSelectScene.js';
import { CombatScene } from './scenes/CombatScene.js';
import { PvPScene } from './scenes/PvPScene.js';
import { ShopScene } from './scenes/ShopScene.js';
import { InventoryScene } from './scenes/InventoryScene.js';
import { AIArenaScene } from './scenes/AIArenaScene.js';
import { mountLangToggle } from './langToggle.js';

const config = {
  type: Phaser.AUTO,
  width: 960,
  height: 640,
  parent: 'game-container',
  backgroundColor: '#0a0a1a',
  scene: [BootScene, LoginScene, LobbyScene, MiningScene, DungeonSelectScene, CombatScene, PvPScene, ShopScene, InventoryScene, AIArenaScene],
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
};

const game = new Phaser.Game(config);

// 全局语言切换按钮（DOM 悬浮层，独立于 Phaser 场景生命周期）
mountLangToggle();

// 调试/自动化验证入口（生产无副作用，仅暴露实例引用）
if (typeof window !== 'undefined') window.__game = game;

