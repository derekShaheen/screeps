var config = require('v2.config');
var memory = require('v2.memory');
var tasks = require('v2.tasks');
var utils = require('v2.utils');

function countMySites() {
    var total = 0;
    for(var roomName in Game.rooms) {
        total += Game.rooms[roomName].find(FIND_MY_CONSTRUCTION_SITES).length;
    }
    return total;
}

function makeRoomPosition(room, x, y) {
    if(x < 0 || x > 49 || y < 0 || y > 49) {
        return null;
    }

    return new RoomPosition(x, y, room.name);
}

function canBuildAt(room, pos, structureType) {
    if(!pos ||
        pos.roomName != room.name ||
        pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49 ||
        room.getTerrain().get(pos.x, pos.y) == TERRAIN_MASK_WALL) {
        return false;
    }

    if(utils.hasSite(pos)) {
        return false;
    }

    var structures = pos.lookFor(LOOK_STRUCTURES);
    for(var i = 0; i < structures.length; i++) {
        if(structureType == STRUCTURE_ROAD &&
            structures[i].structureType == STRUCTURE_RAMPART) {
            continue;
        }
        return false;
    }

    return true;
}

function addPos(positions, seen, pos) {
    if(!pos || seen[utils.posKey(pos)]) {
        return;
    }

    seen[utils.posKey(pos)] = true;
    positions.push(pos);
}

function getExitToward(roomName, targetRoomName, nearPos) {
    if(roomName == targetRoomName || !Game.rooms[roomName]) {
        return null;
    }

    var direction = Game.map.findExit(roomName, targetRoomName);
    if(typeof direction != 'number') {
        return null;
    }

    var exits = Game.rooms[roomName].find(direction);
    exits.sort(function(a, b) {
        return nearPos ? a.getRangeTo(nearPos) - b.getRangeTo(nearPos) : a.x - b.x || a.y - b.y;
    });

    return exits[0] || null;
}

function addPath(room, positions, seen, fromPos, toPos, range) {
    if(!fromPos || !toPos || fromPos.roomName != room.name || toPos.roomName != room.name) {
        return;
    }

    var path = room.findPath(fromPos, toPos, {
        ignoreCreeps: true,
        range: range === undefined ? 1 : range
    });

    for(var i = 0; i < path.length; i++) {
        addPos(positions, seen, new RoomPosition(path[i].x, path[i].y, room.name));
    }
}

function addSpawnRoadIntents(room, positions, seen) {
    var spawns = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });
    var directions = [
        [0, -1], [1, 0], [0, 1], [-1, 0]
    ];

    for(var i = 0; i < spawns.length; i++) {
        var spawn = spawns[i];
        for(var dx = -1; dx <= 1; dx++) {
            for(var dy = -1; dy <= 1; dy++) {
                if(dx !== 0 || dy !== 0) {
                    addPos(positions, seen, makeRoomPosition(room, spawn.pos.x + dx, spawn.pos.y + dy));
                }
            }
        }

        for(var d = 0; d < directions.length; d++) {
            for(var step = 2; step <= 5; step++) {
                addPos(
                    positions,
                    seen,
                    makeRoomPosition(
                        room,
                        spawn.pos.x + directions[d][0] * step,
                        spawn.pos.y + directions[d][1] * step
                    )
                );
            }
        }
    }
}

function addWorkedSourceRoadIntents(room, positions, seen) {
    var sourceTasks = tasks.getSourceSlotTasks();
    var seenSources = {};

    for(var i = 0; i < sourceTasks.length; i++) {
        if(tasks.countAssignedMiners(sourceTasks[i].id) === 0 || seenSources[sourceTasks[i].sourceId]) {
            continue;
        }
        seenSources[sourceTasks[i].sourceId] = true;

        var sourcePos = utils.unpackPos(sourceTasks[i].sourcePos);
        var spawn = utils.getClosestSpawn(sourcePos);
        if(!spawn) {
            continue;
        }

        if(room.name == sourcePos.roomName) {
            var sourceStart = spawn.room.name == room.name ?
                spawn.pos :
                getExitToward(room.name, spawn.room.name, sourcePos);
            addPath(room, positions, seen, sourceStart, sourcePos, 1);
        }

        if(room.name == spawn.room.name && sourcePos.roomName != room.name) {
            var homeExit = getExitToward(room.name, sourcePos.roomName, spawn.pos);
            addPath(room, positions, seen, spawn.pos, homeExit, 0);
        }

        var route = Game.map.findRoute(spawn.room.name, sourcePos.roomName);
        if(!(route instanceof Array)) {
            continue;
        }

        for(var r = 0; r < route.length - 1; r++) {
            if(route[r].room != room.name) {
                continue;
            }

            var entry = getExitToward(room.name, r === 0 ? spawn.room.name : route[r - 1].room, utils.roomCenter(room.name));
            var exit = getExitToward(room.name, route[r + 1].room, entry || utils.roomCenter(room.name));
            addPath(room, positions, seen, entry, exit, 0);
        }
    }
}

function getRoadIntentPositions(room) {
    var positions = [];
    var seen = {};

    var roads = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_ROAD;
        }
    });
    for(var i = 0; i < roads.length; i++) {
        addPos(positions, seen, roads[i].pos);
    }

    var sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: function(site) {
            return site.structureType == STRUCTURE_ROAD;
        }
    });
    for(var s = 0; s < sites.length; s++) {
        addPos(positions, seen, sites[s].pos);
    }

    addSpawnRoadIntents(room, positions, seen);
    addWorkedSourceRoadIntents(room, positions, seen);
    return positions;
}

function isNearRoadIntent(pos, roadIntents, range) {
    if(!pos) {
        return false;
    }

    for(var i = 0; i < roadIntents.length; i++) {
        if(pos.getRangeTo(roadIntents[i]) <= range) {
            return true;
        }
    }

    return false;
}

function planRoads(room, remaining) {
    var roadIntents = getRoadIntentPositions(room);
    var placed = 0;

    for(var i = 0; i < roadIntents.length && placed < remaining; i++) {
        if(canBuildAt(room, roadIntents[i], STRUCTURE_ROAD)) {
            if(roadIntents[i].createConstructionSite(STRUCTURE_ROAD) == OK) {
                placed++;
            }
        }
    }

    return placed;
}

function planExtensions(room, remaining) {
    if(!room.controller || !room.controller.my || remaining <= 0) {
        return 0;
    }

    var allowed = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][room.controller.level] || 0;
    var existing = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_EXTENSION;
        }
    }).length;
    var sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: function(site) {
            return site.structureType == STRUCTURE_EXTENSION;
        }
    }).length;
    var missing = allowed - existing - sites;
    if(missing <= 0) {
        return 0;
    }

    var spawns = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });
    if(!spawns.length) {
        return 0;
    }

    var roadIntents = getRoadIntentPositions(room);
    var placed = 0;
    for(var range = 2; range <= 9 && placed < remaining && placed < missing; range++) {
        for(var dx = -range; dx <= range && placed < remaining && placed < missing; dx++) {
            for(var dy = -range; dy <= range && placed < remaining && placed < missing; dy++) {
                if(Math.max(Math.abs(dx), Math.abs(dy)) != range) {
                    continue;
                }

                var pos = makeRoomPosition(room, spawns[0].pos.x + dx, spawns[0].pos.y + dy);
                if(isNearRoadIntent(pos, roadIntents, 2) &&
                    canBuildAt(room, pos, STRUCTURE_EXTENSION) &&
                    pos.createConstructionSite(STRUCTURE_EXTENSION) == OK) {
                    placed++;
                }
            }
        }
    }

    return placed;
}

function run() {
    var existingSites = countMySites();
    var remaining = Math.max(0, config.maxConstructionSitesPerTick - existingSites);
    if(remaining <= 0) {
        return;
    }

    var visibleRooms = [];
    for(var roomName in Game.rooms) {
        if(!memory.isRoomHostile(roomName)) {
            visibleRooms.push(Game.rooms[roomName]);
        }
    }

    for(var i = 0; i < visibleRooms.length && remaining > 0; i++) {
        var roadPlaced = planRoads(visibleRooms[i], remaining);
        remaining -= roadPlaced;
    }

    var ownedRooms = utils.getOwnedRoomsWithSpawns();
    for(var r = 0; r < ownedRooms.length && remaining > 0; r++) {
        var extPlaced = planExtensions(ownedRooms[r], remaining);
        remaining -= extPlaced;
    }
}

module.exports = {
    run: run,
    getRoadIntentPositions: getRoadIntentPositions
};
