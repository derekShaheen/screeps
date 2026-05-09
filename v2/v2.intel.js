var config = require('v2.config');
var memory = require('v2.memory');
var utils = require('v2.utils');

function hasCombatParts(creep) {
    return creep.getActiveBodyparts(ATTACK) > 0 ||
        creep.getActiveBodyparts(RANGED_ATTACK) > 0;
}

function isHostileStructure(structure) {
    return structure.structureType != STRUCTURE_CONTROLLER;
}

function roomHasCombatHostiles(room) {
    return room.find(FIND_HOSTILE_CREEPS, {
        filter: hasCombatParts
    }).length > 0;
}

function roomHasHostileBuildings(room) {
    return room.find(FIND_HOSTILE_STRUCTURES, {
        filter: isHostileStructure
    }).length > 0;
}

function markHostile(room, reason) {
    var roomMemory = memory.getRoomMemory(room.name);
    roomMemory.status = 'hostile';
    roomMemory.reason = reason || 'hostile';
    roomMemory.hostileUntil = Game.time + config.hostileTicks;
    roomMemory.lastSeen = Game.time;
}

function getOpenSourceSlots(room, source) {
    var slots = [];
    var terrain = room.getTerrain();

    for(var dx = -1; dx <= 1; dx++) {
        for(var dy = -1; dy <= 1; dy++) {
            if(dx === 0 && dy === 0) {
                continue;
            }

            var x = source.pos.x + dx;
            var y = source.pos.y + dy;
            if(x <= 0 || x >= 49 || y <= 0 || y >= 49) {
                continue;
            }

            if(terrain.get(x, y) == TERRAIN_MASK_WALL) {
                continue;
            }

            slots.push(utils.packPos(new RoomPosition(x, y, room.name)));
        }
    }

    return slots;
}

function observeRoom(room) {
    var roomMemory = memory.getRoomMemory(room.name);
    roomMemory.lastSeen = Game.time;

    if(roomHasCombatHostiles(room)) {
        markHostile(room, 'combat hostile');
        return;
    }

    if(roomHasHostileBuildings(room)) {
        markHostile(room, 'hostile structure');
        return;
    }

    roomMemory.status = room.controller && room.controller.my ? 'owned' : 'safe';
    delete roomMemory.reason;
    delete roomMemory.hostileUntil;

    var sources = room.find(FIND_SOURCES);
    roomMemory.sources = [];
    for(var i = 0; i < sources.length; i++) {
        roomMemory.sources.push({
            id: sources[i].id,
            pos: utils.packPos(sources[i].pos),
            slots: getOpenSourceSlots(room, sources[i])
        });
    }

    roomMemory.exits = [];
    var exits = Game.map.describeExits(room.name) || {};
    for(var direction in exits) {
        var exitRoom = exits[direction];
        roomMemory.exits.push(exitRoom);
        memory.getRoomMemory(exitRoom);
    }
}

function observeVisibleRooms() {
    for(var roomName in Game.rooms) {
        observeRoom(Game.rooms[roomName]);
    }
}

function getSafeSources() {
    var result = [];
    var root = memory.getMemory();

    for(var roomName in root.rooms) {
        var roomMemory = root.rooms[roomName];
        if(memory.isRoomHostile(roomName)) {
            continue;
        }
        if(roomMemory.status != 'safe' && roomMemory.status != 'owned') {
            continue;
        }

        var sources = roomMemory.sources || [];
        for(var i = 0; i < sources.length; i++) {
            result.push({
                roomName: roomName,
                sourceId: sources[i].id,
                pos: utils.unpackPos(sources[i].pos),
                slots: sources[i].slots || []
            });
        }
    }

    return result;
}

function getUnknownScoutTargets() {
    var targets = [];
    var root = memory.getMemory();

    for(var roomName in root.rooms) {
        var roomMemory = root.rooms[roomName];
        if(memory.isRoomHostile(roomName)) {
            continue;
        }

        if(roomMemory.status == 'unknown' ||
            (roomMemory.lastSeen && Game.time - roomMemory.lastSeen > config.staleRoomTicks)) {
            targets.push(roomName);
        }
    }

    return targets;
}

function retreatIfDanger(creep, movement) {
    if(!roomHasCombatHostiles(creep.room) && !roomHasHostileBuildings(creep.room)) {
        return false;
    }

    markHostile(creep.room, roomHasHostileBuildings(creep.room) ? 'hostile structure' : 'combat hostile');
    var spawn = utils.getClosestSpawn(creep.pos);
    if(spawn) {
        movement.moveTo(creep, spawn, 1);
        return true;
    }

    return false;
}

module.exports = {
    observeVisibleRooms: observeVisibleRooms,
    getSafeSources: getSafeSources,
    getUnknownScoutTargets: getUnknownScoutTargets,
    retreatIfDanger: retreatIfDanger,
    roomHasCombatHostiles: roomHasCombatHostiles,
    roomHasHostileBuildings: roomHasHostileBuildings
};
