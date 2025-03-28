import Phaser from 'phaser';
export default class CharacterSelectScene extends Phaser.Scene {
    constructor() { super('CharacterSelectScene'); }
    create() {
        console.log('CharacterSelectScene create');
        this.add.text(100, 100, 'Character Select - TODO', { color: '#fff'});
        // TODO: Fetch characters, display them, allow selection, start GameScene
    }
}