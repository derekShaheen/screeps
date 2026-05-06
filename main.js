var debug = require('utils.debug');
var constructionManager = require('manager.construction');
var labManager = require('manager.lab');
var linkManager = require('manager.link');
var marketManager = require('manager.market');
var remoteManager = require('manager.remote');
var spawnManager = require('manager.spawn');
var towerManager = require('manager.tower');
var uiManager = require('manager.ui');
var creepUtils = require('utils.creep');
var roleHarvester = require('role.harvester');
var roleBuilder = require('role.builder');
var roleDefender = require('role.defender');
var roleMineralHarvester = require('role.mineralHarvester');
var roleClaimer = require('role.claimer');
var roleRemoteHauler = require('role.remoteHauler');
var roleRemoteMiner = require('role.remoteMiner');
var roleReserver = require('role.reserver');
var roleScout = require('role.scout');
var roleTransporter = require('role.transporter');
var roleUpgrader = require('role.upgrader');

var DEFAULT_ROOM_MEMORY = {
    creepTargets: {
        harvester: 2,
        transporter: 0,
        upgrader: 1,
        builder: 2,
        mineralHarvester: 0,
        defender: 0
    },
    spawnBudget: {
        threshold: 2000,
        ratio: 0.75
    },
    wallTargetHits: 1000,
    defenseMode: false,
    construction: {
        autoExtensions: true,
        autoSpawns: true,
        autoTowers: true,
        autoStorage: true,
        autoContainers: true,
        autoRoads: true,
        autoRoadReplanning: true,
        autoDismantleRoadBlockers: true,
        autoRemoveMisplacedSites: true,
        maxEarlyRoadSitesPerTick: 2,
        minContainerRcl: 2,
        minExtensionsBeforeContainers: 5,
        autoLinks: true,
        autoExtractor: true,
        autoTerminal: true,
        autoFactory: true,
        autoLabs: true,
        autoRamparts: false,
        autoExitWalls: true,
        autoWallTargetHits: true,
        maxTotalSites: 20,
        maxInfrastructureSites: 12,
        maxNewInfrastructureSitesPerTick: 4,
        minDefenseSites: 4,
        maxDefenseSites: 12,
        maxNewDefenseSitesPerTick: 3,
        minWallRcl: 2,
        requireTowerForDefense: true,
        plannerInterval: 10
    },
    remote: {
        enabled: true,
        maxRooms: 2,
        minHomeRcl: 3,
        claimMinHomeRcl: 6,
        minHaulEnergy: 300,
        staleRoomTicks: 1500,
        unsafeRoomCooldown: 500
    },
    market: {
        enabled: true
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

function getOwnedRoomNames() {
    var ownedRooms = {};

    for(var roomName in Game.rooms) {
        var room = Game.rooms[roomName];
        if(room.controller && room.controller.my) {
            ownedRooms[roomName] = true;
        }
    }

    return ownedRooms;
}

function isOwnedRoom(room) {
    return !!(room && room.controller && room.controller.my);
}

function cleanupInvalidRoomMemory() {
    if(!Memory.rooms) {
        Memory.rooms = {};
    }

    var ownedRooms = getOwnedRoomNames();
    var validRooms = {};

    for(var visibleRoomName in Game.rooms) {
        validRooms[visibleRoomName] = true;
    }

    for(var ownedRoomName in ownedRooms) {
        validRooms[ownedRoomName] = true;

        var ownedMemory = Memory.rooms[ownedRoomName];
        var remoteRooms = ownedMemory && ownedMemory.remote && ownedMemory.remote.rooms;
        if(!remoteRooms) {
            continue;
        }

        for(var remoteRoomName in remoteRooms) {
            validRooms[remoteRoomName] = true;
        }
    }

    for(var memoryRoomName in Memory.rooms) {
        if(validRooms[memoryRoomName]) {
            continue;
        }

        delete Memory.rooms[memoryRoomName];
        debug.log('debugRoles', 'Cleared stale room memory for ' + memoryRoomName, 1);
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

    if(!memory.spawnBudget) {
        memory.spawnBudget = {};
    }

    for(var spawnBudgetKey in DEFAULT_ROOM_MEMORY.spawnBudget) {
        if(memory.spawnBudget[spawnBudgetKey] === undefined) {
            memory.spawnBudget[spawnBudgetKey] = DEFAULT_ROOM_MEMORY.spawnBudget[spawnBudgetKey];
        }
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

    if(!memory.remote) {
        memory.remote = {};
    }

    for(var remoteKey in DEFAULT_ROOM_MEMORY.remote) {
        if(memory.remote[remoteKey] === undefined) {
            memory.remote[remoteKey] = DEFAULT_ROOM_MEMORY.remote[remoteKey];
        }
    }

    if(!memory.market) {
        memory.market = {};
    }

    for(var marketKey in DEFAULT_ROOM_MEMORY.market) {
        if(memory.market[marketKey] === undefined) {
            memory.market[marketKey] = DEFAULT_ROOM_MEMORY.market[marketKey];
        }
    }
}

function runCreep(creep) {
    if(creep.spawning) {
        return;
    }

    var isRemoteRole = creep.memory.role == 'remoteMiner' ||
        creep.memory.role == 'claimer' ||
        creep.memory.role == 'reserver' ||
        creep.memory.role == 'scout' ||
        creep.memory.role == 'remoteHauler' ||
        (creep.memory.role == 'transporter' && creep.memory.remoteHauling);
    if(creep.memory.role != 'defender' && !isRemoteRole && creepUtils.retreatFromHostiles(creep, 5)) {
        return;
    }

    if(creep.memory.role == 'harvester') {
        roleHarvester.run(creep);
        return;
    }

    if(creep.memory.role == 'builder') {
        roleBuilder.run(creep);
        return;
    }

    if(creep.memory.role == 'transporter') {
        roleTransporter.run(creep);
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

    if(creep.memory.role == 'mineralHarvester') {
        roleMineralHarvester.run(creep);
        return;
    }

    if(creep.memory.role == 'remoteMiner') {
        roleRemoteMiner.run(creep);
        return;
    }

    if(creep.memory.role == 'claimer') {
        roleClaimer.run(creep);
        return;
    }

    if(creep.memory.role == 'reserver') {
        roleReserver.run(creep);
        return;
    }

    if(creep.memory.role == 'scout') {
        roleScout.run(creep);
        return;
    }

    if(creep.memory.role == 'remoteHauler') {
        roleRemoteHauler.run(creep);
        return;
    }

    debug.log('debugRoles', creep.name + ' has unknown role ' + creep.memory.role, 5);
}

function initializeConsoleHelpers() {
    global.remoteReport = function(roomName) {
        return remoteManager.getReport(roomName, spawnManager);
    };

    global.marketReport = function(roomName) {
        return marketManager.getReport(roomName);
    };
}

module.exports.loop = function () {
    debug.initialize();
    initializeConsoleHelpers();
    cleanupCreepMemory();
    cleanupInvalidRoomMemory();

    for(var roomName in Game.rooms) {
        if(isOwnedRoom(Game.rooms[roomName])) {
            initializeRoomMemory(Game.rooms[roomName]);
        }
    }

    for(var towerRoomName in Game.rooms) {
        if(isOwnedRoom(Game.rooms[towerRoomName])) {
            towerManager.run(Game.rooms[towerRoomName]);
        }
    }

    for(var linkRoomName in Game.rooms) {
        if(isOwnedRoom(Game.rooms[linkRoomName])) {
            linkManager.run(Game.rooms[linkRoomName]);
        }
    }

    for(var labRoomName in Game.rooms) {
        if(isOwnedRoom(Game.rooms[labRoomName])) {
            labManager.run(Game.rooms[labRoomName]);
        }
    }

    for(var marketRoomName in Game.rooms) {
        if(isOwnedRoom(Game.rooms[marketRoomName])) {
            marketManager.run(Game.rooms[marketRoomName]);
        }
    }

    for(var remoteRoomName in Game.rooms) {
        if(isOwnedRoom(Game.rooms[remoteRoomName])) {
            remoteManager.run(Game.rooms[remoteRoomName]);
        }
    }

    for(var constructionRoomName in Game.rooms) {
        if(isOwnedRoom(Game.rooms[constructionRoomName])) {
            constructionManager.run(Game.rooms[constructionRoomName]);
        }
    }

    for(var spawnName in Game.spawns) {
        spawnManager.run(Game.spawns[spawnName]);
    }

    for(var creepName in Game.creeps) {
        runCreep(Game.creeps[creepName]);
    }

    for(var uiRoomName in Game.rooms) {
        if(isOwnedRoom(Game.rooms[uiRoomName])) {
            uiManager.run(Game.rooms[uiRoomName]);
        }
    }
};
