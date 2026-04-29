var debug = require('utils.debug');
var spawnManager = require('manager.spawn');
var towerManager = require('manager.tower');
var uiManager = require('manager.ui');
var roleHarvester = require('role.harvester');
var roleBuilder = require('role.builder');
var roleUpgrader = require('role.upgrader');

var DEFAULT_ROOM_MEMORY = {
    creepTargets: {
        harvester: 2,
        upgrader: 1,
        builder: 1
    },
    wallTargetHits: 1000,
    defenseMode: false
};

function cleanupCreepMemory() {
    if(!Memory.creeps) {
        Memory.creeps = {};
    }

    for(var name in Memory.creeps) {
        if(!Game.creeps[name]) {
            delete Memory.creeps[name];
            debug.log('debugRoles', 'Cleared memory for dead creep ' + name, 1);
        }
    }
}

function initializeRoomMemory(room) {
    if(!Memory.rooms) {
        Memory.rooms = {};
    }

    if(!Memory.rooms[room.name]) {
        Memory.rooms[room.name] = {};
    }

    var memory = Memory.rooms[room.name];
    if(!memory.creepTargets) {
        memory.creepTargets = {};
    }

    for(var role in DEFAULT_ROOM_MEMORY.creepTargets) {
        if(memory.creepTargets[role] === undefined) {
            memory.creepTargets[role] = DEFAULT_ROOM_MEMORY.creepTargets[role];
        }
    }

    if(memory.wallTargetHits === undefined) {
        memory.wallTargetHits = DEFAULT_ROOM_MEMORY.wallTargetHits;
    }

    if(memory.defenseMode === undefined) {
        memory.defenseMode = DEFAULT_ROOM_MEMORY.defenseMode;
    }
}

function runCreep(creep) {
    if(creep.memory.role == 'harvester') {
        roleHarvester.run(creep);
        return;
    }

    if(creep.memory.role == 'builder') {
        roleBuilder.run(creep);
        return;
    }

    if(creep.memory.role == 'upgrader') {
        roleUpgrader.run(creep);
        return;
    }

    debug.log('debugRoles', creep.name + ' has unknown role ' + creep.memory.role, 5);
}

module.exports.loop = function () {
    debug.initialize();
    cleanupCreepMemory();

    for(var roomName in Game.rooms) {
        initializeRoomMemory(Game.rooms[roomName]);
    }

    for(var towerRoomName in Game.rooms) {
        towerManager.run(Game.rooms[towerRoomName]);
    }

    for(var spawnName in Game.spawns) {
        spawnManager.run(Game.spawns[spawnName]);
    }

    for(var creepName in Game.creeps) {
        runCreep(Game.creeps[creepName]);
    }

    for(var uiRoomName in Game.rooms) {
        uiManager.run(Game.rooms[uiRoomName]);
    }
};
