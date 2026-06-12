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

