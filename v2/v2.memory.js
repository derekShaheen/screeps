var config = require('v2.config');

function getMemory() {
    if(!Memory.creeps) {
        Memory.creeps = {};
    }

    if(!Memory[config.memoryKey] || typeof Memory[config.memoryKey] != 'object') {
        Memory[config.memoryKey] = {};
    }

    var memory = Memory[config.memoryKey];
    if(!memory.rooms || typeof memory.rooms != 'object') {
        memory.rooms = {};
    }
    if(!memory.roadUsage || typeof memory.roadUsage != 'object') {
        memory.roadUsage = {};
    }
    if(!memory.pathUsage || typeof memory.pathUsage != 'object') {
        memory.pathUsage = {};
    }

    return memory;
}

function getRoomMemory(roomName) {
    var memory = getMemory();
    if(!memory.rooms[roomName]) {
        memory.rooms[roomName] = {
            status: 'unknown',
            sources: [],
            exits: []
        };
    }

    return memory.rooms[roomName];
}

function isRoomHostile(roomName) {
    var roomMemory = getRoomMemory(roomName);
    if(roomMemory.status != 'hostile') {
        return false;
    }

    if(roomMemory.hostileUntil && roomMemory.hostileUntil <= Game.time) {
        roomMemory.status = 'unknown';
        delete roomMemory.reason;
        delete roomMemory.hostileUntil;
        return false;
    }

    return true;
}

function cleanupCreeps() {
    getMemory();
    for(var name in Memory.creeps) {
        if(!Game.creeps[name]) {
            delete Memory.creeps[name];
        }
    }
}

function scrubUndefined(value) {
    if(!value || typeof value != 'object') {
        return;
    }

    for(var key in value) {
        if(value[key] === undefined) {
            delete value[key];
        }
        else if(value[key] && typeof value[key] == 'object') {
            scrubUndefined(value[key]);
        }
    }
}

module.exports = {
    getMemory: getMemory,
    getRoomMemory: getRoomMemory,
    isRoomHostile: isRoomHostile,
    cleanupCreeps: cleanupCreeps,
    scrubUndefined: scrubUndefined
};
