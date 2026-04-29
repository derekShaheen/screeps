var debug = require('utils.debug');
var constructionManager = require('manager.construction');
var spawnManager = require('manager.spawn');
var towerManager = require('manager.tower');
var uiManager = require('manager.ui');
var roleHarvester = require('role.harvester');
var roleBuilder = require('role.builder');
var roleDefender = require('role.defender');
var roleUpgrader = require('role.upgrader');

var DEFAULT_ROOM_MEMORY = {
    creepTargets: {
        harvester: 2,
        upgrader: 1,
        builder: 1,
        defender: 1
    },
    wallTargetHits: 1000,
    defenseMode: false,
    construction: {
        autoExtensions: true,
        autoTowers: true,
        autoStorage: true,
        autoContainers: true,
        autoRoads: true,
        autoRamparts: true,
        autoExitWalls: true,
        maxTotalSites: 20,
        maxInfrastructureSites: 12,
        maxNewInfrastructureSitesPerTick: 4,
        maxDefenseSites: 12,
        maxNewDefenseSitesPerTick: 3,
        minWallRcl: 2
    }
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

    if(!memory.construction) {
        memory.construction = {};
    }

    for(var constructionKey in DEFAULT_ROOM_MEMORY.construction) {
        if(memory.construction[constructionKey] === undefined) {
            memory.construction[constructionKey] = DEFAULT_ROOM_MEMORY.construction[constructionKey];
        }
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

    if(creep.memory.role == 'defender') {
        roleDefender.run(creep);
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

    for(var constructionRoomName in Game.rooms) {
        constructionManager.run(Game.rooms[constructionRoomName]);
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
