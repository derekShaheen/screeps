function posKey(pos) {
    return pos.x + ':' + pos.y;
}

function packPos(pos) {
    return {
        x: pos.x,
        y: pos.y,
        roomName: pos.roomName
    };
}

function unpackPos(pos) {
    return new RoomPosition(pos.x, pos.y, pos.roomName);
}

function getRange(fromPos, toPos) {
    if(!fromPos || !toPos) {
        return 9999;
    }

    if(fromPos.roomName == toPos.roomName) {
        return fromPos.getRangeTo(toPos);
    }

    return Game.map.getRoomLinearDistance(fromPos.roomName, toPos.roomName) * 50 +
        Math.max(Math.abs(fromPos.x - toPos.x), Math.abs(fromPos.y - toPos.y));
}

function getAllSpawns() {
    var spawns = [];
    for(var name in Game.spawns) {
        spawns.push(Game.spawns[name]);
    }

    return spawns;
}

function getOwnedRoomsWithSpawns() {
    var rooms = {};
    var spawns = getAllSpawns();
    for(var i = 0; i < spawns.length; i++) {
        rooms[spawns[i].room.name] = spawns[i].room;
    }

    var result = [];
    for(var roomName in rooms) {
        result.push(rooms[roomName]);
    }

    return result;
}

function getClosestSpawn(pos) {
    var spawns = getAllSpawns();
    var best = null;
    var bestRange = 9999;

    for(var i = 0; i < spawns.length; i++) {
        var range = getRange(pos, spawns[i].pos);
        if(range < bestRange) {
            best = spawns[i];
            bestRange = range;
        }
    }

    return best;
}

function getClosestOwnedController(pos) {
    var rooms = getOwnedRoomsWithSpawns();
    var best = null;
    var bestRange = 9999;

    for(var i = 0; i < rooms.length; i++) {
        if(!rooms[i].controller || !rooms[i].controller.my) {
            continue;
        }

        var range = getRange(pos, rooms[i].controller.pos);
        if(range < bestRange) {
            best = rooms[i].controller;
            bestRange = range;
        }
    }

    return best;
}

function roomCenter(roomName) {
    return new RoomPosition(25, 25, roomName);
}

function hasStructure(pos, structureType) {
    var structures = pos.lookFor(LOOK_STRUCTURES);
    for(var i = 0; i < structures.length; i++) {
        if(structures[i].structureType == structureType) {
            return true;
        }
    }

    return false;
}

function hasSite(pos, structureType) {
    var sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    for(var i = 0; i < sites.length; i++) {
        if(!structureType || sites[i].structureType == structureType) {
            return true;
        }
    }

    return false;
}

module.exports = {
    posKey: posKey,
    packPos: packPos,
    unpackPos: unpackPos,
    getRange: getRange,
    getAllSpawns: getAllSpawns,
    getOwnedRoomsWithSpawns: getOwnedRoomsWithSpawns,
    getClosestSpawn: getClosestSpawn,
    getClosestOwnedController: getClosestOwnedController,
    roomCenter: roomCenter,
    hasStructure: hasStructure,
    hasSite: hasSite
};
