var debug = require('utils.debug');
var defenseUtils = require('utils.defense');

var BUILDING_STRUCTURES = {};
BUILDING_STRUCTURES[STRUCTURE_EXTENSION] = true;
BUILDING_STRUCTURES[STRUCTURE_TOWER] = true;
BUILDING_STRUCTURES[STRUCTURE_STORAGE] = true;
BUILDING_STRUCTURES[STRUCTURE_CONTAINER] = true;
BUILDING_STRUCTURES[STRUCTURE_LINK] = true;
BUILDING_STRUCTURES[STRUCTURE_EXTRACTOR] = true;
BUILDING_STRUCTURES[STRUCTURE_LAB] = true;
BUILDING_STRUCTURES[STRUCTURE_TERMINAL] = true;

var REPLANNABLE_ROAD_BLOCKERS = {};
REPLANNABLE_ROAD_BLOCKERS[STRUCTURE_EXTENSION] = true;
REPLANNABLE_ROAD_BLOCKERS[STRUCTURE_CONTAINER] = true;
REPLANNABLE_ROAD_BLOCKERS[STRUCTURE_LINK] = true;
REPLANNABLE_ROAD_BLOCKERS[STRUCTURE_LAB] = true;
REPLANNABLE_ROAD_BLOCKERS[STRUCTURE_WALL] = true;

function formatPos(pos) {
    return pos.roomName + ':' + pos.x + ',' + pos.y;
}

function getTerrain(room, x, y) {
    return room.getTerrain().get(x, y);
}

function isRoomEdge(pos) {
    return pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49;
}

function isExitBuffer(pos) {
    return pos.x <= 1 || pos.x >= 48 || pos.y <= 1 || pos.y >= 48;
}

function isCoreBuildTile(room, pos) {
    return !isRoomEdge(pos) && getTerrain(room, pos.x, pos.y) != TERRAIN_MASK_WALL;
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

function hasConstructionSite(pos, structureType) {
    var sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    for(var i = 0; i < sites.length; i++) {
        if(!structureType || sites[i].structureType == structureType) {
            return true;
        }
    }

    return false;
}

function hasRoadOrRoadSite(pos) {
    return hasStructure(pos, STRUCTURE_ROAD) || hasConstructionSite(pos, STRUCTURE_ROAD);
}

function getConstructionSites(pos) {
    return pos.lookFor(LOOK_CONSTRUCTION_SITES);
}

function hasBlockingStructure(pos, structureType) {
    var structures = pos.lookFor(LOOK_STRUCTURES);
    for(var i = 0; i < structures.length; i++) {
        if(structureType == STRUCTURE_ROAD && structures[i].structureType == STRUCTURE_RAMPART) {
            continue;
        }

        return true;
    }

    return false;
}

function countConstructionSites(room, predicate) {
    return room.find(FIND_CONSTRUCTION_SITES, {
        filter: predicate
    }).length;
}

function countStructuresAndSites(room, structureType) {
    var structures = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == structureType;
        }
    }).length;

    var sites = room.find(FIND_CONSTRUCTION_SITES, {
        filter: function(site) {
            return site.structureType == structureType;
        }
    }).length;

    return structures + sites;
}

function getAllowedCount(room, structureType) {
    if(structureType == STRUCTURE_ROAD ||
        structureType == STRUCTURE_WALL ||
        structureType == STRUCTURE_RAMPART) {
        return 2500;
    }

    if(structureType == STRUCTURE_CONTAINER) {
        return 5;
    }

    if(typeof CONTROLLER_STRUCTURES === 'undefined' ||
        !CONTROLLER_STRUCTURES[structureType] ||
        !room.controller) {
        return 0;
    }

    return CONTROLLER_STRUCTURES[structureType][room.controller.level] || 0;
}

function needsMore(room, structureType) {
    return countStructuresAndSites(room, structureType) < getAllowedCount(room, structureType);
}

function getRecommendedWallTargetHits(room) {
    if(!room.controller) {
        return 1000;
    }

    if(room.controller.level >= 6) {
        return 100000;
    }

    if(room.controller.level >= 5) {
        return 50000;
    }

    if(room.controller.level >= 4) {
        return 25000;
    }

    if(room.controller.level >= 3) {
        return 10000;
    }

    return 1000;
}

function updateWallTargetHits(room, settings) {
    if(settings.autoWallTargetHits === false) {
        return;
    }

    var recommended = getRecommendedWallTargetHits(room);
    if(room.memory.wallTargetHits === undefined || room.memory.wallTargetHits < recommended) {
        room.memory.wallTargetHits = recommended;
        debug.log(
            'debugConstruction',
            room.name + ' wall target hits now ' + recommended,
            1
        );
    }
}

function canCreateSite(room, pos, structureType) {
    if(pos.roomName != room.name) {
        return false;
    }

    if(getTerrain(room, pos.x, pos.y) == TERRAIN_MASK_WALL) {
        return false;
    }

    if(hasConstructionSite(pos)) {
        return false;
    }

    if((structureType == STRUCTURE_WALL || structureType == STRUCTURE_RAMPART) &&
        isExitBuffer(pos)) {
        return false;
    }

    if(structureType == STRUCTURE_EXTRACTOR) {
        return !hasStructure(pos, STRUCTURE_EXTRACTOR) &&
            pos.lookFor(LOOK_MINERALS).length > 0;
    }

    if(structureType == STRUCTURE_RAMPART) {
        return !hasStructure(pos, STRUCTURE_RAMPART);
    }

    if(structureType == STRUCTURE_WALL) {
        return !hasBlockingStructure(pos, structureType);
    }

    if(structureType == STRUCTURE_ROAD) {
        return !hasStructure(pos, STRUCTURE_ROAD) && !hasBlockingStructure(pos, structureType);
    }

    if(!isCoreBuildTile(room, pos)) {
        return false;
    }

    return !hasBlockingStructure(pos, structureType);
}

function createSite(room, pos, structureType) {
    if(!canCreateSite(room, pos, structureType)) {
        return ERR_INVALID_TARGET;
    }

    var result = pos.createConstructionSite(structureType);
    if(result == OK) {
        debug.log(
            'debugConstruction',
            room.name + ' planned ' + structureType + ' at ' + formatPos(pos),
            1
        );
        return result;
    }

    debug.log(
        'debugConstruction',
        room.name + ' failed to plan ' + structureType + ' at ' + formatPos(pos) + ': ' + result,
        10
    );
    return result;
}

function getPrimarySpawn(room) {
    var spawns = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });

    return spawns[0] || null;
}

function getSpawns(room) {
    return room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });
}

function isReservedSpawnRoadOffset(dx, dy) {
    if(dx === 0 && dy === 0) {
        return false;
    }

    return Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
}

function isEarlySpawnRoadOffset(dx, dy) {
    if(dx === 0 && dy === 0) {
        return false;
    }

    return Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
}

function isReservedBaseRoadTile(room, pos) {
    return !!getRoadIntentState(room).map[getPosKey(pos)];
}

function addRoadIntentPosition(room, state, pos) {
    if(!pos || pos.roomName != room.name || getTerrain(room, pos.x, pos.y) == TERRAIN_MASK_WALL) {
        return;
    }

    var key = getPosKey(pos);
    if(state.map[key]) {
        return;
    }

    state.map[key] = true;
    state.positions.push(pos);
}

function addRoadIntentPath(room, state, path) {
    for(var i = 0; i < path.length; i++) {
        addRoadIntentPosition(room, state, path[i]);
    }
}

function getRoadIntentState(room) {
    if(room._roadIntentState &&
        typeof Game !== 'undefined' &&
        room._roadIntentState.time == Game.time) {
        return room._roadIntentState.state;
    }

    var state = {
        positions: [],
        map: {}
    };
    var spawns = getSpawns(room);
    if(!spawns.length) {
        return state;
    }

    var primary = spawns[0];
    for(var i = 0; i < spawns.length; i++) {
        addRoadIntentPath(room, state, getSpawnRoadLoopPositions(room, spawns[i]));
        addRoadIntentPath(room, state, getSpawnRoadSpokePositions(room, spawns[i]));
    }

    for(var s = 1; s < spawns.length; s++) {
        addRoadIntentPath(room, state, getPath(room, primary.pos, spawns[s].pos, 1));
    }

    var baseTargets = getBaseRoadTargets(room);
    for(var b = 0; b < baseTargets.length; b++) {
        var nearestSpawn = getNearestSpawn(spawns, baseTargets[b].pos);
        addRoadIntentPath(room, state, getPath(room, nearestSpawn.pos, baseTargets[b].pos, 1));
    }

    var sources = room.find(FIND_SOURCES);
    for(var sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
        addRoadIntentPath(room, state, getPath(room, primary.pos, sources[sourceIndex].pos, 1));
    }

    if(room.controller) {
        addRoadIntentPath(room, state, getPath(room, primary.pos, room.controller.pos, 2));
    }

    var exitTargets = getExitRampartRoadTargets(room);
    for(var e = 0; e < exitTargets.length; e++) {
        var nearestExitSpawn = getNearestSpawn(spawns, exitTargets[e].pos);
        addRoadIntentPath(room, state, getPath(room, nearestExitSpawn.pos, exitTargets[e].pos, 0));
    }

    var roads = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_ROAD;
        }
    });
    for(var r = 0; r < roads.length; r++) {
        addRoadIntentPosition(room, state, roads[r].pos);
    }

    var roadSites = room.find(FIND_CONSTRUCTION_SITES, {
        filter: function(site) {
            return site.structureType == STRUCTURE_ROAD;
        }
    });
    for(var c = 0; c < roadSites.length; c++) {
        addRoadIntentPosition(room, state, roadSites[c].pos);
    }

    if(typeof Game !== 'undefined') {
        room._roadIntentState = {
            time: Game.time,
            state: state
        };
    }

    return state;
}

function getRoadIntentRange(room, pos) {
    var state = getRoadIntentState(room);
    var best = 999;
    for(var i = 0; i < state.positions.length; i++) {
        best = Math.min(best, pos.getRangeTo(state.positions[i]));
        if(best <= 1) {
            return best;
        }
    }

    return best;
}

function isNearRoadIntent(room, pos, range) {
    return getRoadIntentRange(room, pos) <= range;
}

function canReplanRoadBlocker(structure) {
    if(structure.structureType == STRUCTURE_ROAD ||
        structure.structureType == STRUCTURE_RAMPART ||
        structure.structureType == STRUCTURE_SPAWN ||
        structure.structureType == STRUCTURE_TOWER ||
        structure.structureType == STRUCTURE_STORAGE ||
        structure.structureType == STRUCTURE_TERMINAL ||
        structure.structureType == STRUCTURE_EXTRACTOR) {
        return false;
    }

    return !!REPLANNABLE_ROAD_BLOCKERS[structure.structureType];
}

function getCandidateRing(room, anchor, minRange, maxRange) {
    var candidates = [];
    for(var dx = -maxRange; dx <= maxRange; dx++) {
        for(var dy = -maxRange; dy <= maxRange; dy++) {
            var range = Math.max(Math.abs(dx), Math.abs(dy));
            if(range < minRange || range > maxRange) {
                continue;
            }

            var x = anchor.pos.x + dx;
            var y = anchor.pos.y + dy;
            if(x <= 1 || x >= 48 || y <= 1 || y >= 48) {
                continue;
            }

            var pos = new RoomPosition(x, y, room.name);
            if(isCoreBuildTile(room, pos)) {
                candidates.push(pos);
            }
        }
    }

    return candidates;
}

function sortCoreCandidates(room, candidates, structureType) {
    var spawn = getPrimarySpawn(room);
    candidates.sort(function(a, b) {
        var aSwamp = getTerrain(room, a.x, a.y) == TERRAIN_MASK_SWAMP ? 3 : 0;
        var bSwamp = getTerrain(room, b.x, b.y) == TERRAIN_MASK_SWAMP ? 3 : 0;
        var aRoadShape = structureType == STRUCTURE_EXTENSION ? (a.x + a.y) % 2 : 0;
        var bRoadShape = structureType == STRUCTURE_EXTENSION ? (b.x + b.y) % 2 : 0;
        var aScore = aSwamp + aRoadShape;
        var bScore = bSwamp + bRoadShape;

        if(structureType == STRUCTURE_EXTENSION) {
            aScore += getRoadIntentRange(room, a) * 2;
            bScore += getRoadIntentRange(room, b) * 2;
        }

        if(spawn) {
            aScore += a.getRangeTo(spawn);
            bScore += b.getRangeTo(spawn);
        }

        if(room.controller) {
            aScore += a.getRangeTo(room.controller) * 0.2;
            bScore += b.getRangeTo(room.controller) * 0.2;
        }

        return aScore - bScore;
    });
}

function planCoreStructure(room, structureType, minRange, maxRange, remaining) {
    if(remaining <= 0 || !needsMore(room, structureType)) {
        return 0;
    }

    var spawn = getPrimarySpawn(room);
    if(!spawn) {
        return 0;
    }

    var placed = 0;
    var needed = getAllowedCount(room, structureType) - countStructuresAndSites(room, structureType);
    var candidates = getCandidateRing(room, spawn, minRange, maxRange);
    sortCoreCandidates(room, candidates, structureType);

    for(var i = 0; i < candidates.length && placed < remaining && placed < needed; i++) {
        if(isReservedBaseRoadTile(room, candidates[i])) {
            continue;
        }

        if(structureType == STRUCTURE_EXTENSION && !isNearRoadIntent(room, candidates[i], 2)) {
            continue;
        }

        var result = createSite(room, candidates[i], structureType);
        if(result == OK) {
            placed++;
        }

        if(result == ERR_FULL) {
            break;
        }
    }

    if(placed > 0) {
        debug.log(
            'debugConstruction',
            room.name + ' planned ' + placed + ' ' + structureType + ' site(s)',
            1
        );
    }

    return placed;
}

function getStructures(room, structureType) {
    return room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == structureType;
        }
    });
}

function getStorage(room) {
    var storage = getStructures(room, STRUCTURE_STORAGE);
    return storage[0] || null;
}

function getTerminal(room) {
    var terminals = getStructures(room, STRUCTURE_TERMINAL);
    return terminals[0] || null;
}

function getAnchorStructure(room) {
    return getStorage(room) || getPrimarySpawn(room);
}

function getCandidateRingAroundPos(room, anchorPos, minRange, maxRange) {
    var candidates = [];
    for(var dx = -maxRange; dx <= maxRange; dx++) {
        for(var dy = -maxRange; dy <= maxRange; dy++) {
            var range = Math.max(Math.abs(dx), Math.abs(dy));
            if(range < minRange || range > maxRange) {
                continue;
            }

            var x = anchorPos.x + dx;
            var y = anchorPos.y + dy;
            if(x <= 1 || x >= 48 || y <= 1 || y >= 48) {
                continue;
            }

            var pos = new RoomPosition(x, y, room.name);
            if(isCoreBuildTile(room, pos)) {
                candidates.push(pos);
            }
        }
    }

    return candidates;
}

function sortByAnchor(room, candidates, anchorPos, structureType) {
    var spawn = getPrimarySpawn(room);
    candidates.sort(function(a, b) {
        var aRoadShape = structureType == STRUCTURE_LAB ? (a.x + a.y) % 2 : 0;
        var bRoadShape = structureType == STRUCTURE_LAB ? (b.x + b.y) % 2 : 0;
        var aScore = a.getRangeTo(anchorPos) + aRoadShape;
        var bScore = b.getRangeTo(anchorPos) + bRoadShape;

        if(spawn) {
            aScore += a.getRangeTo(spawn) * 0.15;
            bScore += b.getRangeTo(spawn) * 0.15;
        }

        if(room.controller) {
            aScore += a.getRangeTo(room.controller) * 0.1;
            bScore += b.getRangeTo(room.controller) * 0.1;
        }

        return aScore - bScore;
    });
}

function planAnchoredStructure(room, structureType, anchorPos, minRange, maxRange, remaining) {
    if(remaining <= 0 || !needsMore(room, structureType) || !anchorPos) {
        return 0;
    }

    var placed = 0;
    var needed = getAllowedCount(room, structureType) - countStructuresAndSites(room, structureType);
    var candidates = getCandidateRingAroundPos(room, anchorPos, minRange, maxRange);
    sortByAnchor(room, candidates, anchorPos, structureType);

    for(var i = 0; i < candidates.length && placed < remaining && placed < needed; i++) {
        if(isReservedBaseRoadTile(room, candidates[i])) {
            continue;
        }

        var result = createSite(room, candidates[i], structureType);
        if(result == OK) {
            placed++;
        }

        if(result == ERR_FULL) {
            break;
        }
    }

    if(placed > 0) {
        debug.log(
            'debugConstruction',
            room.name + ' planned ' + placed + ' ' + structureType + ' anchored site(s)',
            1
        );
    }

    return placed;
}

function hasNearbyStructureOrSite(pos, structureType, range) {
    var structures = pos.findInRange(FIND_STRUCTURES, range, {
        filter: function(structure) {
            return structure.structureType == structureType;
        }
    });

    if(structures.length) {
        return true;
    }

    var sites = pos.findInRange(FIND_CONSTRUCTION_SITES, range, {
        filter: function(site) {
            return site.structureType == structureType;
        }
    });

    return sites.length > 0;
}

function getAdjacentBuildTiles(room, targetPos) {
    var positions = [];
    for(var dx = -1; dx <= 1; dx++) {
        for(var dy = -1; dy <= 1; dy++) {
            if(dx === 0 && dy === 0) {
                continue;
            }

            var x = targetPos.x + dx;
            var y = targetPos.y + dy;
            var pos = new RoomPosition(x, y, room.name);
            if(isCoreBuildTile(room, pos)) {
                positions.push(pos);
            }
        }
    }

    return positions;
}

function planSourceContainers(room, remaining) {
    if(remaining <= 0 || !needsMore(room, STRUCTURE_CONTAINER)) {
        return 0;
    }

    var spawn = getPrimarySpawn(room);
    var sources = room.find(FIND_SOURCES);
    var placed = 0;
    var needed = getAllowedCount(room, STRUCTURE_CONTAINER) - countStructuresAndSites(room, STRUCTURE_CONTAINER);

    for(var i = 0; i < sources.length && placed < remaining && placed < needed; i++) {
        if(hasNearbyStructureOrSite(sources[i].pos, STRUCTURE_CONTAINER, 1)) {
            continue;
        }

        var positions = getAdjacentBuildTiles(room, sources[i].pos);
        positions.sort(function(a, b) {
            var aScore = spawn ? a.getRangeTo(spawn) : 0;
            var bScore = spawn ? b.getRangeTo(spawn) : 0;

            if(room.controller) {
                aScore += a.getRangeTo(room.controller) * 0.2;
                bScore += b.getRangeTo(room.controller) * 0.2;
            }

            return aScore - bScore;
        });

        for(var j = 0; j < positions.length && placed < remaining && placed < needed; j++) {
            var result = createSite(room, positions[j], STRUCTURE_CONTAINER);
            if(result == OK) {
                placed++;
                break;
            }

            if(result == ERR_FULL) {
                return placed;
            }
        }
    }

    return placed;
}

function planControllerContainer(room, remaining) {
    if(remaining <= 0 || !needsMore(room, STRUCTURE_CONTAINER) || !room.controller) {
        return 0;
    }

    if(hasNearbyStructureOrSite(room.controller.pos, STRUCTURE_CONTAINER, 3)) {
        return 0;
    }

    var spawn = getPrimarySpawn(room);
    var sources = room.find(FIND_SOURCES);
    var candidates = [];

    for(var range = 2; range <= 3; range++) {
        for(var dx = -range; dx <= range; dx++) {
            for(var dy = -range; dy <= range; dy++) {
                if(Math.max(Math.abs(dx), Math.abs(dy)) != range) {
                    continue;
                }

                var x = room.controller.pos.x + dx;
                var y = room.controller.pos.y + dy;
                if(x <= 1 || x >= 48 || y <= 1 || y >= 48) {
                    continue;
                }

                var pos = new RoomPosition(x, y, room.name);
                if(isCoreBuildTile(room, pos)) {
                    candidates.push(pos);
                }
            }
        }
    }

    candidates.sort(function(a, b) {
        var aScore = spawn ? a.getRangeTo(spawn) : 0;
        var bScore = spawn ? b.getRangeTo(spawn) : 0;

        for(var i = 0; i < sources.length; i++) {
            aScore += a.getRangeTo(sources[i]) * 0.1;
            bScore += b.getRangeTo(sources[i]) * 0.1;
        }

        return aScore - bScore;
    });

    for(var j = 0; j < candidates.length; j++) {
        var result = createSite(room, candidates[j], STRUCTURE_CONTAINER);
        if(result == OK) {
            debug.log(
                'debugConstruction',
                room.name + ' planned controller container at ' + formatPos(candidates[j]),
                1
            );
            return 1;
        }

        if(result == ERR_FULL) {
            return 0;
        }
    }

    return 0;
}

function planContainers(room, remaining) {
    var placed = planSourceContainers(room, remaining);
    if(placed < remaining) {
        placed += planControllerContainer(room, remaining - placed);
    }

    return placed;
}

function addStructureCosts(room, costs) {
    var structures = room.find(FIND_STRUCTURES);
    for(var i = 0; i < structures.length; i++) {
        var structure = structures[i];

        if(structure.structureType == STRUCTURE_ROAD) {
            costs.set(structure.pos.x, structure.pos.y, 1);
            continue;
        }

        if(structure.structureType == STRUCTURE_RAMPART) {
            costs.set(structure.pos.x, structure.pos.y, 2);
            continue;
        }

        if(structure.structureType == STRUCTURE_CONTAINER) {
            costs.set(structure.pos.x, structure.pos.y, 5);
            continue;
        }

        costs.set(structure.pos.x, structure.pos.y, 255);
    }
}

function addConstructionSiteCosts(room, costs) {
    var sites = room.find(FIND_CONSTRUCTION_SITES);
    for(var i = 0; i < sites.length; i++) {
        var site = sites[i];

        if(site.structureType == STRUCTURE_ROAD) {
            costs.set(site.pos.x, site.pos.y, 1);
            continue;
        }

        if(site.structureType == STRUCTURE_RAMPART) {
            costs.set(site.pos.x, site.pos.y, 2);
            continue;
        }

        costs.set(site.pos.x, site.pos.y, 255);
    }
}

function getPath(room, fromPos, toPos, range) {
    if(typeof PathFinder !== 'undefined') {
        var result = PathFinder.search(fromPos, {pos: toPos, range: range}, {
            plainCost: 2,
            swampCost: 10,
            maxRooms: 1,
            roomCallback: function(roomName) {
                if(roomName != room.name) {
                    return false;
                }

                var costs = new PathFinder.CostMatrix();
                for(var i = 0; i < 50; i++) {
                    costs.set(i, 0, 255);
                    costs.set(i, 49, 255);
                    costs.set(0, i, 255);
                    costs.set(49, i, 255);
                }

                addStructureCosts(room, costs);
                addConstructionSiteCosts(room, costs);

                return costs;
            }
        });

        if(!result.incomplete) {
            return result.path.filter(function(pos) {
                return pos.roomName == room.name;
            });
        }
    }

    var path = fromPos.findPathTo(toPos, {
        ignoreCreeps: true,
        range: range
    });

    var positions = [];
    for(var i = 0; i < path.length; i++) {
        positions.push(new RoomPosition(path[i].x, path[i].y, room.name));
    }

    return positions;
}

function planRoadPositions(room, positions, remaining) {
    var placed = 0;
    var seen = {};

    for(var i = 0; i < positions.length && placed < remaining; i++) {
        var pos = positions[i];
        var key = getPosKey(pos);
        if(seen[key]) {
            continue;
        }

        seen[key] = true;
        if(hasRoadOrRoadSite(pos)) {
            continue;
        }

        var result = createSite(room, pos, STRUCTURE_ROAD);
        if(result == OK) {
            placed++;
        }

        if(result == ERR_FULL) {
            break;
        }
    }

    return placed;
}

function planRoadPath(room, fromPos, toPos, range, remaining) {
    var placed = 0;
    var path = getPath(room, fromPos, toPos, range);

    for(var i = 0; i < path.length && placed < remaining; i++) {
        if(path[i].roomName != room.name) {
            continue;
        }

        var result = createSite(room, path[i], STRUCTURE_ROAD);
        if(result == OK) {
            placed++;
        }

        if(result == ERR_FULL) {
            break;
        }
    }

    return placed;
}

function getSpawnRoadLoopPositions(room, spawn) {
    var positions = [];
    for(var dx = -1; dx <= 1; dx++) {
        for(var dy = -1; dy <= 1; dy++) {
            if(!isReservedSpawnRoadOffset(dx, dy)) {
                continue;
            }

            var x = spawn.pos.x + dx;
            var y = spawn.pos.y + dy;
            if(x <= 1 || x >= 48 || y <= 1 || y >= 48) {
                continue;
            }

            var pos = new RoomPosition(x, y, room.name);
            if(isCoreBuildTile(room, pos)) {
                positions.push(pos);
            }
        }
    }

    positions.sort(function(a, b) {
        return a.getRangeTo(spawn) - b.getRangeTo(spawn);
    });

    return positions;
}

function getSpawnRoadSpokePositions(room, spawn) {
    var positions = [];
    var directions = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0]
    ];

    for(var i = 0; i < directions.length; i++) {
        for(var range = 2; range <= 5; range++) {
            var x = spawn.pos.x + directions[i][0] * range;
            var y = spawn.pos.y + directions[i][1] * range;
            if(x <= 1 || x >= 48 || y <= 1 || y >= 48) {
                break;
            }

            var pos = new RoomPosition(x, y, room.name);
            if(!isCoreBuildTile(room, pos) ||
                (hasBlockingStructure(pos, STRUCTURE_ROAD) && !hasStructure(pos, STRUCTURE_ROAD))) {
                break;
            }

            positions.push(pos);
        }
    }

    return positions;
}

function getEarlySpawnRoadPositions(room, spawn) {
    var positions = [];
    for(var dx = -1; dx <= 1; dx++) {
        for(var dy = -1; dy <= 1; dy++) {
            if(!isEarlySpawnRoadOffset(dx, dy)) {
                continue;
            }

            var x = spawn.pos.x + dx;
            var y = spawn.pos.y + dy;
            if(x <= 1 || x >= 48 || y <= 1 || y >= 48) {
                continue;
            }

            var pos = new RoomPosition(x, y, room.name);
            if(isCoreBuildTile(room, pos)) {
                positions.push(pos);
            }
        }
    }

    positions.sort(function(a, b) {
        return a.getRangeTo(spawn) - b.getRangeTo(spawn);
    });

    return positions;
}

function planSpawnRoadLoops(room, spawns, remaining) {
    var placed = 0;
    for(var i = 0; i < spawns.length && placed < remaining; i++) {
        placed += planRoadPositions(
            room,
            getSpawnRoadLoopPositions(room, spawns[i]),
            remaining - placed
        );
    }

    if(placed > 0) {
        debug.log(
            'debugConstruction',
            room.name + ' planned ' + placed + ' spawn circulation road site(s)',
            1
        );
    }

    return placed;
}

function planSpawnRoadSpokes(room, spawns, remaining) {
    var placed = 0;
    for(var i = 0; i < spawns.length && placed < remaining; i++) {
        placed += planRoadPositions(
            room,
            getSpawnRoadSpokePositions(room, spawns[i]),
            remaining - placed
        );
    }

    if(placed > 0) {
        debug.log(
            'debugConstruction',
            room.name + ' planned ' + placed + ' spawn road spoke site(s)',
            1
        );
    }

    return placed;
}

function getNearestSpawn(spawns, pos) {
    var nearest = spawns[0] || null;
    for(var i = 1; i < spawns.length; i++) {
        if(spawns[i].pos.getRangeTo(pos) < nearest.pos.getRangeTo(pos)) {
            nearest = spawns[i];
        }
    }

    return nearest;
}

function isMajorBaseRoadTarget(structureType) {
    return structureType == STRUCTURE_STORAGE ||
        structureType == STRUCTURE_TERMINAL ||
        structureType == STRUCTURE_TOWER ||
        structureType == STRUCTURE_LINK;
}

function getBaseRoadTargets(room) {
    var targets = [];
    var structures = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return isMajorBaseRoadTarget(structure.structureType);
        }
    });

    var sites = room.find(FIND_CONSTRUCTION_SITES, {
        filter: function(site) {
            return site.my !== false && isMajorBaseRoadTarget(site.structureType);
        }
    });

    for(var i = 0; i < structures.length; i++) {
        targets.push(structures[i]);
    }

    for(var j = 0; j < sites.length; j++) {
        targets.push(sites[j]);
    }

    return targets;
}

function isExitSealRoadTargetPos(pos) {
    return pos.x <= 2 || pos.x >= 47 || pos.y <= 2 || pos.y >= 47;
}

function addExitRampartRoadTarget(room, targets, seen, pos) {
    if(!pos || pos.roomName != room.name || !isExitSealRoadTargetPos(pos)) {
        return;
    }

    if(getTerrain(room, pos.x, pos.y) == TERRAIN_MASK_WALL) {
        return;
    }

    var key = getPosKey(pos);
    if(seen[key]) {
        return;
    }

    seen[key] = true;
    targets.push({pos: pos});
}

function getExitRampartRoadTargets(room) {
    var targets = [];
    var seen = {};
    var segments = groupExitSegments(room);

    for(var i = 0; i < segments.length; i++) {
        var plan = getExitSealPlan(room, segments[i]);
        var gatePos = getExitSealPos(room, plan.side, plan.gate);
        for(var j = 0; j < plan.positions.length; j++) {
            if(plan.positions[j].structureType == STRUCTURE_RAMPART) {
                addExitRampartRoadTarget(room, targets, seen, plan.positions[j].pos);
            }
        }

        if(hasStructure(gatePos, STRUCTURE_RAMPART) ||
            hasConstructionSite(gatePos, STRUCTURE_RAMPART)) {
            addExitRampartRoadTarget(room, targets, seen, gatePos);
        }
    }

    return targets;
}

function planSpawnLinks(room, spawns, remaining) {
    if(spawns.length <= 1 || remaining <= 0) {
        return 0;
    }

    var placed = 0;
    var primary = spawns[0];
    for(var i = 1; i < spawns.length && placed < remaining; i++) {
        placed += planRoadPath(room, primary.pos, spawns[i].pos, 1, remaining - placed);
    }

    return placed;
}

function planBaseAccessRoads(room, spawns, remaining) {
    if(remaining <= 0 || !spawns.length) {
        return 0;
    }

    var placed = 0;
    var primary = spawns[0];
    var targets = getBaseRoadTargets(room);

    targets.sort(function(a, b) {
        return a.pos.getRangeTo(primary) - b.pos.getRangeTo(primary);
    });

    for(var i = 0; i < targets.length && placed < remaining; i++) {
        var nearestSpawn = getNearestSpawn(spawns, targets[i].pos);
        placed += planRoadPath(room, nearestSpawn.pos, targets[i].pos, 1, remaining - placed);
    }

    return placed;
}

function planExitRampartAccessRoads(room, spawns, remaining) {
    if(remaining <= 0 || !spawns.length) {
        return 0;
    }

    var placed = 0;
    var targets = getExitRampartRoadTargets(room);
    var primary = spawns[0];

    targets.sort(function(a, b) {
        return a.pos.getRangeTo(primary) - b.pos.getRangeTo(primary);
    });

    for(var i = 0; i < targets.length && placed < remaining; i++) {
        var nearestSpawn = getNearestSpawn(spawns, targets[i].pos);
        placed += planRoadPath(room, nearestSpawn.pos, targets[i].pos, 0, remaining - placed);
    }

    if(placed > 0) {
        debug.log(
            'debugConstruction',
            room.name + ' planned ' + placed + ' exit rampart access road site(s)',
            1
        );
    }

    return placed;
}

function planRoads(room, remaining) {
    if(remaining <= 0) {
        return 0;
    }

    var spawns = getSpawns(room);
    if(!spawns.length) {
        return 0;
    }

    var placed = 0;
    var spawn = spawns[0];

    placed += planSpawnRoadLoops(room, spawns, remaining - placed);

    if(placed < remaining) {
        placed += planSpawnRoadSpokes(room, spawns, remaining - placed);
    }

    if(placed < remaining) {
        placed += planSpawnLinks(room, spawns, remaining - placed);
    }

    if(placed < remaining) {
        placed += planBaseAccessRoads(room, spawns, remaining - placed);
    }

    var sources = room.find(FIND_SOURCES);
    for(var i = 0; i < sources.length && placed < remaining; i++) {
        placed += planRoadPath(room, spawn.pos, sources[i].pos, 1, remaining - placed);
    }

    if(room.controller && placed < remaining) {
        placed += planRoadPath(room, spawn.pos, room.controller.pos, 2, remaining - placed);
    }

    if(placed < remaining) {
        placed += planExitRampartAccessRoads(room, spawns, remaining - placed);
    }

    return placed;
}

function planEarlyRoads(room, remaining) {
    if(remaining <= 0) {
        return 0;
    }

    var spawns = getSpawns(room);
    if(!spawns.length) {
        return 0;
    }

    var placed = 0;
    for(var i = 0; i < spawns.length && placed < remaining; i++) {
        placed += planRoadPositions(
            room,
            getEarlySpawnRoadPositions(room, spawns[i]),
            remaining - placed
        );
    }

    if(placed > 0) {
        debug.log(
            'debugConstruction',
            room.name + ' planned ' + placed + ' early spawn access road site(s)',
            1
        );
    }

    return placed;
}

function getEarlyExtensionTarget(room, settings) {
    var allowed = getAllowedCount(room, STRUCTURE_EXTENSION);
    if(allowed <= 0) {
        return 0;
    }

    var configuredTarget = settings.minExtensionsBeforeContainers;
    var target = typeof configuredTarget == 'number' ? Math.max(5, configuredTarget) : 5;
    return Math.min(allowed, target);
}

function hasEarlyExtensionBatch(room, settings) {
    if(!room.controller || room.controller.level < 2) {
        return false;
    }

    var earlyExtensionTarget = getEarlyExtensionTarget(room, settings);
    if(earlyExtensionTarget <= 0) {
        return true;
    }

    return countStructuresAndSites(room, STRUCTURE_EXTENSION) >= earlyExtensionTarget;
}

function canPlanContainersNow(room, settings) {
    var minContainerRcl = typeof settings.minContainerRcl == 'number' ? settings.minContainerRcl : 2;
    minContainerRcl = Math.max(2, minContainerRcl);
    if(room.controller && room.controller.level < minContainerRcl) {
        return false;
    }

    return hasEarlyExtensionBatch(room, settings);
}

function removeMisplacedRoadBlockingSites(room, positions) {
    var removed = 0;
    for(var i = 0; i < positions.length; i++) {
        var sites = getConstructionSites(positions[i]);
        for(var j = 0; j < sites.length; j++) {
            if(sites[j].structureType == STRUCTURE_ROAD ||
                sites[j].structureType == STRUCTURE_RAMPART ||
                sites[j].my === false) {
                continue;
            }

            var result = sites[j].remove();
            if(result == OK) {
                removed++;
                debug.log(
                    'debugConstruction',
                    room.name + ' removed misplaced ' + sites[j].structureType +
                        ' site from road plan at ' + formatPos(positions[i]),
                    1
                );
            }
        }
    }

    return removed;
}

function getRoadReplanBlockers(room, positions) {
    var blockers = [];
    var seen = {};

    for(var i = 0; i < positions.length; i++) {
        if(hasRoadOrRoadSite(positions[i])) {
            continue;
        }

        var structures = positions[i].lookFor(LOOK_STRUCTURES);
        for(var j = 0; j < structures.length; j++) {
            if(!canReplanRoadBlocker(structures[j]) || seen[structures[j].id]) {
                continue;
            }

            seen[structures[j].id] = true;
            blockers.push(structures[j]);
        }
    }

    return blockers;
}

function rememberRoadReplanTargets(room, blockers) {
    if(!blockers.length) {
        delete room.memory.roadReplanTargets;
        return;
    }

    blockers.sort(function(a, b) {
        return a.hits - b.hits;
    });

    room.memory.roadReplanTargets = blockers.slice(0, 10).map(function(structure) {
        return structure.id;
    });
}

function updateRoadReplanTargets(room, settings) {
    if(settings.autoRoads === false ||
        settings.autoRoadReplanning === false ||
        settings.autoDismantleRoadBlockers === false) {
        delete room.memory.roadReplanTargets;
        return;
    }

    var spawns = getSpawns(room);
    if(!spawns.length) {
        delete room.memory.roadReplanTargets;
        return;
    }

    var positions = [];
    for(var i = 0; i < spawns.length; i++) {
        positions = positions.concat(getSpawnRoadLoopPositions(room, spawns[i]));
    }

    if(settings.autoRemoveMisplacedSites !== false) {
        removeMisplacedRoadBlockingSites(room, positions);
    }

    var blockers = getRoadReplanBlockers(room, positions);
    rememberRoadReplanTargets(room, blockers);

    if(blockers.length) {
        debug.log(
            'debugConstruction',
            room.name + ' marked ' + blockers.length + ' road replan blocker(s) for dismantle',
            20
        );
    }
}

function getSourceContainer(source) {
    var containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_CONTAINER;
        }
    });

    return containers[0] || null;
}

function hasLinkNear(pos, range) {
    return hasNearbyStructureOrSite(pos, STRUCTURE_LINK, range);
}

function getLinkCandidatesNearSource(room, source) {
    var candidates = [];
    var container = getSourceContainer(source);

    for(var range = 1; range <= 2; range++) {
        for(var dx = -range; dx <= range; dx++) {
            for(var dy = -range; dy <= range; dy++) {
                if(Math.max(Math.abs(dx), Math.abs(dy)) != range) {
                    continue;
                }

                var x = source.pos.x + dx;
                var y = source.pos.y + dy;
                if(x <= 1 || x >= 48 || y <= 1 || y >= 48) {
                    continue;
                }

                var pos = new RoomPosition(x, y, room.name);
                if(isCoreBuildTile(room, pos)) {
                    candidates.push(pos);
                }
            }
        }
    }

    candidates.sort(function(a, b) {
        var aScore = a.getRangeTo(source) * 3;
        var bScore = b.getRangeTo(source) * 3;

        if(container) {
            aScore += a.getRangeTo(container) * 2;
            bScore += b.getRangeTo(container) * 2;
        }

        if(room.controller) {
            aScore += a.getRangeTo(room.controller) * 0.1;
            bScore += b.getRangeTo(room.controller) * 0.1;
        }

        return aScore - bScore;
    });

    return candidates;
}

function planControllerLink(room, remaining) {
    if(remaining <= 0 ||
        !needsMore(room, STRUCTURE_LINK) ||
        !room.controller ||
        hasLinkNear(room.controller.pos, 4)) {
        return 0;
    }

    return planAnchoredStructure(room, STRUCTURE_LINK, room.controller.pos, 2, 4, Math.min(remaining, 1));
}

function planSourceLinks(room, remaining) {
    if(remaining <= 0 || !needsMore(room, STRUCTURE_LINK)) {
        return 0;
    }

    var placed = 0;
    var sources = room.find(FIND_SOURCES);
    sources.sort(function(a, b) {
        var aContainer = getSourceContainer(a) ? 0 : 4;
        var bContainer = getSourceContainer(b) ? 0 : 4;
        return aContainer - bContainer || a.pos.getRangeTo(room.controller || a.pos) - b.pos.getRangeTo(room.controller || b.pos);
    });

    for(var i = 0; i < sources.length && placed < remaining && needsMore(room, STRUCTURE_LINK); i++) {
        if(hasLinkNear(sources[i].pos, 2)) {
            continue;
        }

        var candidates = getLinkCandidatesNearSource(room, sources[i]);
        for(var j = 0; j < candidates.length && placed < remaining && needsMore(room, STRUCTURE_LINK); j++) {
            var result = createSite(room, candidates[j], STRUCTURE_LINK);
            if(result == OK) {
                placed++;
                break;
            }

            if(result == ERR_FULL) {
                return placed;
            }
        }
    }

    if(placed > 0) {
        debug.log('debugConstruction', room.name + ' planned ' + placed + ' source link site(s)', 1);
    }

    return placed;
}

function planLinks(room, remaining) {
    if(remaining <= 0 || !needsMore(room, STRUCTURE_LINK)) {
        return 0;
    }

    var placed = planControllerLink(room, remaining);
    if(placed < remaining) {
        placed += planSourceLinks(room, remaining - placed);
    }

    return placed;
}

function planExtractor(room, remaining) {
    if(remaining <= 0 || !needsMore(room, STRUCTURE_EXTRACTOR)) {
        return 0;
    }

    var minerals = room.find(FIND_MINERALS);
    if(!minerals.length) {
        return 0;
    }

    var result = createSite(room, minerals[0].pos, STRUCTURE_EXTRACTOR);
    if(result == OK) {
        debug.log('debugConstruction', room.name + ' planned extractor at ' + formatPos(minerals[0].pos), 1);
        return 1;
    }

    return 0;
}

function planTerminal(room, remaining) {
    var anchor = getAnchorStructure(room);
    return anchor ? planAnchoredStructure(room, STRUCTURE_TERMINAL, anchor.pos, 2, 4, remaining) : 0;
}

function planLabs(room, remaining) {
    var terminal = getTerminal(room);
    var anchor = terminal || getStorage(room) || getPrimarySpawn(room);
    return anchor ? planAnchoredStructure(room, STRUCTURE_LAB, anchor.pos, 2, 5, remaining) : 0;
}

function planPriorityTowers(room, settings, totalBudget) {
    if(settings.autoTowers === false ||
        totalBudget <= 0 ||
        !needsMore(room, STRUCTURE_TOWER)) {
        return 0;
    }

    var missing = getAllowedCount(room, STRUCTURE_TOWER) - countStructuresAndSites(room, STRUCTURE_TOWER);
    var placed = planCoreStructure(room, STRUCTURE_TOWER, 2, 4, Math.min(totalBudget, missing));
    if(placed > 0) {
        debug.log('debugConstruction', room.name + ' prioritized ' + placed + ' tower construction site(s)', 1);
    }

    return placed;
}

function countDefenseConstructionSites(room) {
    return countConstructionSites(room, function(site) {
        return site.structureType == STRUCTURE_WALL ||
            site.structureType == STRUCTURE_RAMPART;
    });
}

function countDefenseStructuresAndSites(room) {
    var structures = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_WALL ||
                structure.structureType == STRUCTURE_RAMPART;
        }
    }).length;

    return structures + countDefenseConstructionSites(room);
}

function hasTower(room) {
    var towers = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_TOWER;
        }
    });

    return towers.length > 0;
}

function canPlanDefense(room, settings) {
    var minWallRcl = settings.minWallRcl || 2;
    if(room.controller.level < minWallRcl) {
        return false;
    }

    if(settings.requireTowerForDefense !== false && !hasTower(room)) {
        debug.log(
            'debugConstruction',
            room.name + ' defense planner waiting for tower',
            20
        );
        return false;
    }

    return true;
}

function shouldPrioritizeDefense(room, settings) {
    if(!canPlanDefense(room, settings)) {
        return false;
    }

    if(settings.autoExitWalls === false) {
        return false;
    }

    if(!areExitWallsSealed(room)) {
        return true;
    }

    return false;
}

function countInfrastructureConstructionSites(room) {
    return countConstructionSites(room, function(site) {
        return !!BUILDING_STRUCTURES[site.structureType] ||
            site.structureType == STRUCTURE_ROAD;
    });
}

function getStructurePlanStatus(room, structureType) {
    return countStructuresAndSites(room, structureType) + '/' + getAllowedCount(room, structureType);
}

function logInfrastructureIdle(room, settings) {
    var level = room.controller ? room.controller.level : '?';
    var parts = [];

    if(settings.autoExtensions !== false) {
        parts.push('extensions ' + getStructurePlanStatus(room, STRUCTURE_EXTENSION));
    }

    if(settings.autoTowers !== false) {
        parts.push('towers ' + getStructurePlanStatus(room, STRUCTURE_TOWER));
    }

    if(settings.autoStorage !== false) {
        parts.push('storage ' + getStructurePlanStatus(room, STRUCTURE_STORAGE));
    }

    if(settings.autoContainers !== false) {
        parts.push('containers ' + getStructurePlanStatus(room, STRUCTURE_CONTAINER));
    }

    if(settings.autoLinks !== false) {
        parts.push('links ' + getStructurePlanStatus(room, STRUCTURE_LINK));
    }

    if(settings.autoExtractor !== false) {
        parts.push('extractor ' + getStructurePlanStatus(room, STRUCTURE_EXTRACTOR));
    }

    if(settings.autoTerminal !== false) {
        parts.push('terminal ' + getStructurePlanStatus(room, STRUCTURE_TERMINAL));
    }

    if(settings.autoLabs !== false) {
        parts.push('labs ' + getStructurePlanStatus(room, STRUCTURE_LAB));
    }

    if(settings.autoRoads !== false) {
        parts.push('roads checked');
    }

    debug.log(
        'debugConstruction',
        room.name + ' infrastructure planner found no eligible sites at RCL ' +
            level + ': ' + parts.join(', '),
        20
    );
}

function planInfrastructure(room, settings, totalBudget) {
    var maxSites = settings.maxInfrastructureSites || 12;
    var maxNewSites = settings.maxNewInfrastructureSitesPerTick || 4;
    var existingSites = countInfrastructureConstructionSites(room);
    var siteBudget = totalBudget === undefined ? maxNewSites : Math.min(maxNewSites, totalBudget);

    if(existingSites >= maxSites || siteBudget <= 0) {
        debug.log(
            'debugConstruction',
            room.name + ' infrastructure planner paused: ' + existingSites + '/' + maxSites + ' sites',
            20
        );
        return 0;
    }

    var remaining = Math.min(siteBudget, maxSites - existingSites);
    var placed = 0;

    if(settings.autoRoads !== false && placed < remaining) {
        var earlyRoadBudget = settings.maxEarlyRoadSitesPerTick || 2;
        placed += planEarlyRoads(room, Math.min(remaining - placed, earlyRoadBudget));
    }

    if(settings.autoExtensions !== false && placed < remaining) {
        placed += planCoreStructure(room, STRUCTURE_EXTENSION, 2, 5, remaining - placed);
    }

    if(settings.autoTowers !== false && placed < remaining) {
        placed += planCoreStructure(room, STRUCTURE_TOWER, 2, 4, remaining - placed);
    }

    if(settings.autoStorage !== false && placed < remaining) {
        placed += planCoreStructure(room, STRUCTURE_STORAGE, 2, 4, remaining - placed);
    }

    if(settings.autoContainers !== false && placed < remaining && canPlanContainersNow(room, settings)) {
        placed += planContainers(room, remaining - placed);
    }

    if(settings.autoLinks !== false && placed < remaining && hasEarlyExtensionBatch(room, settings)) {
        placed += planLinks(room, remaining - placed);
    }

    if(settings.autoExtractor !== false && placed < remaining && hasEarlyExtensionBatch(room, settings)) {
        placed += planExtractor(room, remaining - placed);
    }

    if(settings.autoTerminal !== false && placed < remaining && hasEarlyExtensionBatch(room, settings)) {
        placed += planTerminal(room, remaining - placed);
    }

    if(settings.autoLabs !== false && placed < remaining && hasEarlyExtensionBatch(room, settings)) {
        placed += planLabs(room, remaining - placed);
    }

    if(settings.autoRoads !== false && placed < remaining && hasEarlyExtensionBatch(room, settings)) {
        placed += planRoads(room, remaining - placed);
    }

    if(placed > 0) {
        debug.log('debugConstruction', room.name + ' placed ' + placed + ' infrastructure construction sites', 1);
    }
    else {
        logInfrastructureIdle(room, settings);
    }

    return placed;
}

function removeObsoleteRampartSites(room) {
    var removed = 0;
    var sites = room.find(FIND_CONSTRUCTION_SITES, {
        filter: function(site) {
            return site.structureType == STRUCTURE_RAMPART &&
                site.my !== false &&
                !defenseUtils.shouldBuildConstructionSite(site);
        }
    });

    for(var i = 0; i < sites.length; i++) {
        var result = sites[i].remove();
        if(result == OK) {
            removed++;
            debug.log(
                'debugConstruction',
                room.name + ' removed obsolete rampart site at ' + formatPos(sites[i].pos),
                1
            );
        }
    }

    return removed;
}

function getExitSide(pos) {
    if(pos.x === 0) {
        return 'W';
    }

    if(pos.x === 49) {
        return 'E';
    }

    if(pos.y === 0) {
        return 'N';
    }

    return 'S';
}

function getExitCoordinate(pos) {
    if(pos.x === 0 || pos.x === 49) {
        return pos.y;
    }

    return pos.x;
}

function getInteriorExitCoordinate(value) {
    if(value <= 1) {
        return 2;
    }

    if(value >= 48) {
        return 47;
    }

    return value;
}

function getTraversalExitCoordinate(value) {
    if(value <= 1) {
        return 1;
    }

    if(value >= 48) {
        return 48;
    }

    return value;
}

function getExitSealPos(room, side, coordinate) {
    var interiorCoordinate = getInteriorExitCoordinate(coordinate);

    if(side == 'W') {
        return new RoomPosition(2, interiorCoordinate, room.name);
    }

    if(side == 'E') {
        return new RoomPosition(47, interiorCoordinate, room.name);
    }

    if(side == 'N') {
        return new RoomPosition(interiorCoordinate, 2, room.name);
    }

    return new RoomPosition(interiorCoordinate, 47, room.name);
}

function getExitTraversalPos(room, side, coordinate, depth) {
    var interiorCoordinate = getTraversalExitCoordinate(coordinate);

    if(side == 'W') {
        return new RoomPosition(depth, interiorCoordinate, room.name);
    }

    if(side == 'E') {
        return new RoomPosition(49 - depth, interiorCoordinate, room.name);
    }

    if(side == 'N') {
        return new RoomPosition(interiorCoordinate, depth, room.name);
    }

    return new RoomPosition(interiorCoordinate, 49 - depth, room.name);
}

function hasExitSeal(pos) {
    var structures = pos.lookFor(LOOK_STRUCTURES);
    for(var i = 0; i < structures.length; i++) {
        if(structures[i].structureType == STRUCTURE_WALL ||
            structures[i].structureType == STRUCTURE_RAMPART) {
            return true;
        }
    }

    var sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    for(var j = 0; j < sites.length; j++) {
        if(sites[j].structureType == STRUCTURE_WALL ||
            sites[j].structureType == STRUCTURE_RAMPART) {
            return true;
        }
    }

    return false;
}

function isNaturallySealed(room, pos) {
    return getTerrain(room, pos.x, pos.y) == TERRAIN_MASK_WALL;
}

function isExitSealComplete(room, pos) {
    return hasExitSeal(pos) || isNaturallySealed(room, pos);
}

function getPosKey(pos) {
    return pos.x + ':' + pos.y;
}

function isExitTraversalBlocked(room, pos) {
    if(pos.x < 1 || pos.x > 48 || pos.y < 1 || pos.y > 48) {
        return true;
    }

    return isExitSealComplete(room, pos);
}

function enqueueExitTraversal(room, queue, visited, pos) {
    if(isExitTraversalBlocked(room, pos)) {
        return;
    }

    var key = getPosKey(pos);
    if(visited[key]) {
        return;
    }

    visited[key] = true;
    queue.push(pos);
}

function isExitSegmentSealed(room, segment) {
    var side = getExitSide(segment[0]);
    var targets = {};
    var hasTarget = false;

    for(var coordinate = 2; coordinate <= 47; coordinate++) {
        var target = getExitTraversalPos(room, side, coordinate, 3);
        if(!isExitTraversalBlocked(room, target)) {
            targets[getPosKey(target)] = true;
            hasTarget = true;
        }
    }

    if(!hasTarget) {
        return true;
    }

    var queue = [];
    var visited = {};
    for(var i = 0; i < segment.length; i++) {
        var start = getExitTraversalPos(room, side, getExitCoordinate(segment[i]), 1);
        enqueueExitTraversal(room, queue, visited, start);
    }

    if(!queue.length) {
        return true;
    }

    var directions = [
        [-1, -1], [0, -1], [1, -1],
        [-1, 0],           [1, 0],
        [-1, 1],  [0, 1],  [1, 1]
    ];

    for(var head = 0; head < queue.length; head++) {
        var current = queue[head];
        if(targets[getPosKey(current)]) {
            return false;
        }

        for(var j = 0; j < directions.length; j++) {
            enqueueExitTraversal(
                room,
                queue,
                visited,
                new RoomPosition(
                    current.x + directions[j][0],
                    current.y + directions[j][1],
                    room.name
                )
            );
        }
    }

    return true;
}

function getExitSealPlan(room, segment) {
    var side = getExitSide(segment[0]);
    var start = getExitCoordinate(segment[0]);
    var end = getExitCoordinate(segment[segment.length - 1]);
    var sealed = isExitSegmentSealed(room, segment);
    var minCoordinate = sealed ? getInteriorExitCoordinate(start) : getExitSealBoundary(room, side, start, -1);
    var maxCoordinate = sealed ? getInteriorExitCoordinate(end) : getExitSealBoundary(room, side, end, 1);
    var gateCoordinate = getInteriorExitCoordinate(Math.floor((start + end) / 2));
    var positions = [];

    if(!sealed) {
        for(var coordinate = minCoordinate; coordinate <= maxCoordinate; coordinate++) {
            positions.push({
                pos: getExitSealPos(room, side, coordinate),
                structureType: coordinate == gateCoordinate ? STRUCTURE_RAMPART : STRUCTURE_WALL
            });
        }
    }

    return {
        side: side,
        sealed: sealed,
        start: minCoordinate,
        end: maxCoordinate,
        gate: gateCoordinate,
        positions: positions
    };
}

function getExitSealBoundary(room, side, coordinate, direction) {
    var current = getInteriorExitCoordinate(coordinate);

    while(true) {
        var next = current + direction;
        if(next < 2 || next > 47) {
            return current;
        }

        var pos = getExitSealPos(room, side, next);
        if(isNaturallySealed(room, pos)) {
            return current;
        }

        current = next;
    }
}

function areExitWallsSealed(room) {
    var segments = groupExitSegments(room);
    for(var i = 0; i < segments.length; i++) {
        var plan = getExitSealPlan(room, segments[i]);
        for(var j = 0; j < plan.positions.length; j++) {
            if(!isExitSealComplete(room, plan.positions[j].pos)) {
                return false;
            }
        }
    }

    return true;
}

function getExitSealStructureType(pos, desiredType) {
    if(desiredType == STRUCTURE_WALL && hasStructure(pos, STRUCTURE_ROAD)) {
        return STRUCTURE_RAMPART;
    }

    return desiredType;
}

function groupExitSegments(room) {
    var exits = room.find(FIND_EXIT);
    var bySide = {
        N: [],
        E: [],
        S: [],
        W: []
    };

    for(var i = 0; i < exits.length; i++) {
        bySide[getExitSide(exits[i])].push(exits[i]);
    }

    var segments = [];
    for(var side in bySide) {
        var positions = bySide[side];
        positions.sort(function(a, b) {
            return getExitCoordinate(a) - getExitCoordinate(b);
        });

        var current = [];
        for(var j = 0; j < positions.length; j++) {
            if(!current.length ||
                getExitCoordinate(positions[j]) == getExitCoordinate(current[current.length - 1]) + 1) {
                current.push(positions[j]);
                continue;
            }

            segments.push(current);
            current = [positions[j]];
        }

        if(current.length) {
            segments.push(current);
        }
    }

    return segments;
}

function planExitSegment(room, segment, remaining) {
    var status = {
        placed: 0,
        blocked: 0,
        missing: 0,
        planned: getExitSealPlan(room, segment)
    };

    if(status.planned.sealed) {
        debug.log(
            'debugConstruction',
            room.name + ' exit ' + status.planned.side + ' seal already blocks traversal',
            50
        );
        return status;
    }

    for(var i = 0; i < status.planned.positions.length; i++) {
        var plannedPosition = status.planned.positions[i];
        var pos = plannedPosition.pos;

        if(isExitSealComplete(room, pos)) {
            continue;
        }

        if(status.placed >= remaining) {
            status.missing++;
            continue;
        }

        var structureType = getExitSealStructureType(pos, plannedPosition.structureType);
        var result = createSite(room, pos, structureType);

        if(result == OK) {
            status.placed++;
            continue;
        }

        if(result == ERR_FULL) {
            status.missing++;
            break;
        }

        status.blocked++;
        status.missing++;
    }

    if(status.placed > 0) {
        debug.log(
            'debugConstruction',
            room.name + ' exit ' + status.planned.side + ' seal planned ' +
                status.placed + ' site(s), gate ' + status.planned.gate +
                ', span ' + status.planned.start + '-' + status.planned.end,
            1
        );
    }

    if(status.blocked > 0) {
        debug.log(
            'debugConstruction',
            room.name + ' exit ' + status.planned.side + ' seal has ' +
                status.blocked + ' blocked tile(s), gate ' + status.planned.gate +
                ', span ' + status.planned.start + '-' + status.planned.end,
            10
        );
    }

    return status;
}

function planExitWalls(room, remaining) {
    var placed = 0;
    var missing = 0;
    var blocked = 0;
    var segments = groupExitSegments(room);
    segments.sort(function(a, b) {
        return a.length - b.length;
    });

    for(var i = 0; i < segments.length; i++) {
        var status = planExitSegment(room, segments[i], remaining - placed);
        placed += status.placed;
        missing += status.missing;
        blocked += status.blocked;
    }

    if(segments.length) {
        room.memory.exitWallsSealed = missing === 0;

        if(room.memory.exitWallsSealed) {
            debug.log(
                'debugConstruction',
                room.name + ' exit wall planner verified ' + segments.length + ' sealed exit segments',
                50
            );
        }
        else {
            debug.log(
                'debugConstruction',
                room.name + ' exit wall planner scanned ' + segments.length +
                    ' exit segments, missing ' + missing + ', blocked ' + blocked,
                10
            );
        }
    }

    return placed;
}

function planDefense(room, settings, totalBudget) {
    if(!canPlanDefense(room, settings)) {
        return 0;
    }

    var maxDefenseSites = settings.maxDefenseSites || 12;
    var maxNewSites = settings.maxNewDefenseSitesPerTick || 3;
    var siteBudget = totalBudget === undefined ? maxNewSites : Math.min(maxNewSites, totalBudget);

    removeObsoleteRampartSites(room);
    var existingDefenseSites = countDefenseConstructionSites(room);

    if(existingDefenseSites >= maxDefenseSites || siteBudget <= 0) {
        debug.log(
            'debugConstruction',
            room.name + ' defense planner paused: ' + existingDefenseSites + '/' + maxDefenseSites + ' defense sites',
            20
        );
        return 0;
    }

    var remaining = Math.min(siteBudget, maxDefenseSites - existingDefenseSites);
    var placed = 0;

    if(settings.autoExitWalls !== false && placed < remaining) {
        placed += planExitWalls(room, remaining - placed);
    }

    if(placed > 0) {
        debug.log('debugConstruction', room.name + ' placed ' + placed + ' defense construction sites', 1);
    }
    else if(settings.autoExitWalls !== false &&
        room.memory.exitWallsSealed !== true) {
        debug.log(
            'debugConstruction',
            room.name + ' defense planner found no valid defense placements',
            10
        );
    }

    return placed;
}

var PLANNER_VISUAL_COLORS = {};
PLANNER_VISUAL_COLORS[STRUCTURE_EXTENSION] = '#ffe066';
PLANNER_VISUAL_COLORS[STRUCTURE_TOWER] = '#ff6666';
PLANNER_VISUAL_COLORS[STRUCTURE_CONTAINER] = '#c49a6c';
PLANNER_VISUAL_COLORS[STRUCTURE_ROAD] = '#66ccff';
PLANNER_VISUAL_COLORS[STRUCTURE_STORAGE] = '#ffffff';
PLANNER_VISUAL_COLORS[STRUCTURE_LINK] = '#66ff99';
PLANNER_VISUAL_COLORS[STRUCTURE_EXTRACTOR] = '#cc99ff';
PLANNER_VISUAL_COLORS[STRUCTURE_TERMINAL] = '#ff99cc';
PLANNER_VISUAL_COLORS[STRUCTURE_LAB] = '#99ccff';
PLANNER_VISUAL_COLORS[STRUCTURE_RAMPART] = '#66ff66';
PLANNER_VISUAL_COLORS[STRUCTURE_WALL] = '#999999';
PLANNER_VISUAL_COLORS[STRUCTURE_SPAWN] = '#ffffff';

var PLANNER_VISUAL_LABELS = {};
PLANNER_VISUAL_LABELS[STRUCTURE_EXTENSION] = 'E';
PLANNER_VISUAL_LABELS[STRUCTURE_TOWER] = 'T';
PLANNER_VISUAL_LABELS[STRUCTURE_CONTAINER] = 'C';
PLANNER_VISUAL_LABELS[STRUCTURE_ROAD] = 'r';
PLANNER_VISUAL_LABELS[STRUCTURE_STORAGE] = 'S';
PLANNER_VISUAL_LABELS[STRUCTURE_LINK] = 'L';
PLANNER_VISUAL_LABELS[STRUCTURE_EXTRACTOR] = 'X';
PLANNER_VISUAL_LABELS[STRUCTURE_TERMINAL] = 'M';
PLANNER_VISUAL_LABELS[STRUCTURE_LAB] = 'B';
PLANNER_VISUAL_LABELS[STRUCTURE_RAMPART] = 'R';
PLANNER_VISUAL_LABELS[STRUCTURE_WALL] = 'W';
PLANNER_VISUAL_LABELS[STRUCTURE_SPAWN] = 'P';

function getPlannerVisualColor(structureType) {
    return PLANNER_VISUAL_COLORS[structureType] || '#ffffff';
}

function getPlannerVisualLabel(structureType) {
    return PLANNER_VISUAL_LABELS[structureType] || '?';
}

function drawPlannerLabel(room, pos, structureType, opacity) {
    room.visual.text(getPlannerVisualLabel(structureType), pos.x, pos.y + 0.18, {
        color: getPlannerVisualColor(structureType),
        font: 0.45,
        opacity: opacity || 0.85,
        align: 'center'
    });
}

function drawPlannerSlot(room, pos, structureType, opacity) {
    room.visual.circle(pos, {
        radius: structureType == STRUCTURE_ROAD ? 0.16 : 0.33,
        fill: getPlannerVisualColor(structureType),
        opacity: opacity || 0.18,
        stroke: getPlannerVisualColor(structureType),
        strokeWidth: 0.04
    });

    if(structureType != STRUCTURE_ROAD) {
        drawPlannerLabel(room, pos, structureType, 0.9);
    }
}

function drawAllocatedPlannerObject(room, pos, structureType, isSite) {
    var color = getPlannerVisualColor(structureType);
    room.visual.rect(pos.x - 0.42, pos.y - 0.42, 0.84, 0.84, {
        fill: color,
        opacity: isSite ? 0.08 : 0.04,
        stroke: color,
        strokeWidth: isSite ? 0.08 : 0.04,
        lineStyle: isSite ? 'dashed' : 'solid'
    });
    drawPlannerLabel(room, pos, structureType, isSite ? 1 : 0.65);
}

function addPlannerVisualPosition(positions, seen, pos, structureType) {
    var key = structureType + ':' + getPosKey(pos);
    if(seen[key]) {
        return;
    }

    seen[key] = true;
    positions.push({
        pos: pos,
        structureType: structureType
    });
}

function drawPlannerPath(room, positions, color) {
    if(positions.length > 1) {
        room.visual.poly(positions, {
            stroke: color,
            strokeWidth: 0.08,
            opacity: 0.45,
            lineStyle: 'dashed'
        });
    }

    for(var i = 0; i < positions.length; i++) {
        drawPlannerSlot(room, positions[i], STRUCTURE_ROAD, 0.12);
    }
}

function getFutureCoreSlots(room, structureType, minRange, maxRange, limit) {
    if(limit <= 0 || !needsMore(room, structureType)) {
        return [];
    }

    var spawn = getPrimarySpawn(room);
    if(!spawn) {
        return [];
    }

    var missing = Math.min(limit, getAllowedCount(room, structureType) - countStructuresAndSites(room, structureType));
    var candidates = getCandidateRing(room, spawn, minRange, maxRange);
    var slots = [];
    sortCoreCandidates(room, candidates, structureType);

    for(var i = 0; i < candidates.length && slots.length < missing; i++) {
        if(isReservedBaseRoadTile(room, candidates[i])) {
            continue;
        }

        if(structureType == STRUCTURE_EXTENSION && !isNearRoadIntent(room, candidates[i], 2)) {
            continue;
        }

        if(canCreateSite(room, candidates[i], structureType)) {
            slots.push(candidates[i]);
        }
    }

    return slots;
}

function getFutureAnchoredSlots(room, structureType, anchorPos, minRange, maxRange, limit) {
    if(limit <= 0 || !anchorPos || !needsMore(room, structureType)) {
        return [];
    }

    var missing = Math.min(limit, getAllowedCount(room, structureType) - countStructuresAndSites(room, structureType));
    var candidates = getCandidateRingAroundPos(room, anchorPos, minRange, maxRange);
    var slots = [];
    sortByAnchor(room, candidates, anchorPos, structureType);

    for(var i = 0; i < candidates.length && slots.length < missing; i++) {
        if(isReservedBaseRoadTile(room, candidates[i])) {
            continue;
        }

        if(structureType == STRUCTURE_EXTENSION && !isNearRoadIntent(room, candidates[i], 2)) {
            continue;
        }

        if(canCreateSite(room, candidates[i], structureType)) {
            slots.push(candidates[i]);
        }
    }

    return slots;
}

function addFutureSlots(visualPositions, seen, slots, structureType, limitState) {
    for(var i = 0; i < slots.length && limitState.count < limitState.limit; i++) {
        addPlannerVisualPosition(visualPositions, seen, slots[i], structureType);
        limitState.count++;
    }
}

function getFirstCreateableSlot(room, slots, structureType) {
    for(var i = 0; i < slots.length; i++) {
        if(canCreateSite(room, slots[i], structureType)) {
            return slots[i];
        }
    }

    return null;
}

function drawAllocatedPlannerObjects(room) {
    var structures = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            return !!BUILDING_STRUCTURES[structure.structureType] ||
                structure.structureType == STRUCTURE_SPAWN ||
                structure.structureType == STRUCTURE_ROAD ||
                structure.structureType == STRUCTURE_RAMPART ||
                structure.structureType == STRUCTURE_WALL;
        }
    });

    for(var i = 0; i < structures.length; i++) {
        drawAllocatedPlannerObject(room, structures[i].pos, structures[i].structureType, false);
    }

    var sites = room.find(FIND_CONSTRUCTION_SITES);
    for(var j = 0; j < sites.length; j++) {
        if(sites[j].my === false) {
            continue;
        }

        drawAllocatedPlannerObject(room, sites[j].pos, sites[j].structureType, true);
    }
}

function drawRoadPlannerVisuals(room, settings) {
    if(settings.autoRoads === false) {
        return;
    }

    var spawns = getSpawns(room);
    if(!spawns.length) {
        return;
    }

    var primary = spawns[0];
    for(var i = 0; i < spawns.length; i++) {
        drawPlannerPath(room, getSpawnRoadLoopPositions(room, spawns[i]), '#66ccff');
        drawPlannerPath(room, getSpawnRoadSpokePositions(room, spawns[i]), '#66ccff');
    }

    for(var s = 1; s < spawns.length; s++) {
        drawPlannerPath(room, getPath(room, primary.pos, spawns[s].pos, 1), '#66ccff');
    }

    var baseTargets = getBaseRoadTargets(room);
    for(var b = 0; b < baseTargets.length; b++) {
        var nearestSpawn = getNearestSpawn(spawns, baseTargets[b].pos);
        drawPlannerPath(room, getPath(room, nearestSpawn.pos, baseTargets[b].pos, 1), '#66ccff');
    }

    var sources = room.find(FIND_SOURCES);
    for(var sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
        drawPlannerPath(room, getPath(room, primary.pos, sources[sourceIndex].pos, 1), '#66ccff');
    }

    if(room.controller) {
        drawPlannerPath(room, getPath(room, primary.pos, room.controller.pos, 2), '#66ccff');
    }

    var exitTargets = getExitRampartRoadTargets(room);
    for(var e = 0; e < exitTargets.length; e++) {
        var nearestExitSpawn = getNearestSpawn(spawns, exitTargets[e].pos);
        drawPlannerPath(room, getPath(room, nearestExitSpawn.pos, exitTargets[e].pos, 0), '#66ccff');
    }
}

function drawFutureBuildingPlannerVisuals(room, settings) {
    var debugSettings = debug.settings();
    var visualPositions = [];
    var seen = {};
    var limitState = {
        count: 0,
        limit: typeof debugSettings.debugConstructionPlannerLimit == 'number' ?
            debugSettings.debugConstructionPlannerLimit :
            120
    };

    if(settings.autoExtensions !== false) {
        addFutureSlots(visualPositions, seen, getFutureCoreSlots(room, STRUCTURE_EXTENSION, 2, 5, limitState.limit), STRUCTURE_EXTENSION, limitState);
    }

    if(settings.autoTowers !== false) {
        addFutureSlots(visualPositions, seen, getFutureCoreSlots(room, STRUCTURE_TOWER, 2, 4, limitState.limit), STRUCTURE_TOWER, limitState);
    }

    if(settings.autoStorage !== false) {
        addFutureSlots(visualPositions, seen, getFutureCoreSlots(room, STRUCTURE_STORAGE, 2, 4, limitState.limit), STRUCTURE_STORAGE, limitState);
    }

    if(settings.autoContainers !== false && canPlanContainersNow(room, settings)) {
        var sources = room.find(FIND_SOURCES);
        for(var i = 0; i < sources.length && limitState.count < limitState.limit; i++) {
            if(hasNearbyStructureOrSite(sources[i].pos, STRUCTURE_CONTAINER, 1)) {
                continue;
            }

            var sourceSlots = getAdjacentBuildTiles(room, sources[i].pos);
            sourceSlots.sort(function(a, b) {
                var spawn = getPrimarySpawn(room);
                var aScore = spawn ? a.getRangeTo(spawn) : 0;
                var bScore = spawn ? b.getRangeTo(spawn) : 0;
                return aScore - bScore;
            });

            var sourceContainerSlot = getFirstCreateableSlot(room, sourceSlots, STRUCTURE_CONTAINER);
            if(sourceContainerSlot) {
                addFutureSlots(visualPositions, seen, [sourceContainerSlot], STRUCTURE_CONTAINER, limitState);
            }
        }

        if(room.controller && !hasNearbyStructureOrSite(room.controller.pos, STRUCTURE_CONTAINER, 3)) {
            addFutureSlots(
                visualPositions,
                seen,
                getFutureAnchoredSlots(room, STRUCTURE_CONTAINER, room.controller.pos, 2, 3, 1),
                STRUCTURE_CONTAINER,
                limitState
            );
        }
    }

    if(settings.autoLinks !== false && hasEarlyExtensionBatch(room, settings)) {
        if(room.controller && !hasLinkNear(room.controller.pos, 4)) {
            addFutureSlots(
                visualPositions,
                seen,
                getFutureAnchoredSlots(room, STRUCTURE_LINK, room.controller.pos, 2, 4, 1),
                STRUCTURE_LINK,
                limitState
            );
        }

        var linkSources = room.find(FIND_SOURCES);
        for(var linkSourceIndex = 0; linkSourceIndex < linkSources.length && limitState.count < limitState.limit; linkSourceIndex++) {
            if(hasLinkNear(linkSources[linkSourceIndex].pos, 2)) {
                continue;
            }

            var sourceLinkSlot = getFirstCreateableSlot(
                room,
                getLinkCandidatesNearSource(room, linkSources[linkSourceIndex]),
                STRUCTURE_LINK
            );
            if(sourceLinkSlot) {
                addFutureSlots(visualPositions, seen, [sourceLinkSlot], STRUCTURE_LINK, limitState);
            }
        }
    }

    if(settings.autoTerminal !== false && hasEarlyExtensionBatch(room, settings)) {
        var anchor = getAnchorStructure(room);
        if(anchor) {
            addFutureSlots(
                visualPositions,
                seen,
                getFutureAnchoredSlots(room, STRUCTURE_TERMINAL, anchor.pos, 2, 4, 1),
                STRUCTURE_TERMINAL,
                limitState
            );
        }
    }

    if(settings.autoLabs !== false && hasEarlyExtensionBatch(room, settings)) {
        var terminal = getTerminal(room);
        var labAnchor = terminal || getStorage(room) || getPrimarySpawn(room);
        if(labAnchor) {
            addFutureSlots(
                visualPositions,
                seen,
                getFutureAnchoredSlots(room, STRUCTURE_LAB, labAnchor.pos, 2, 5, limitState.limit),
                STRUCTURE_LAB,
                limitState
            );
        }
    }

    if(settings.autoExtractor !== false && needsMore(room, STRUCTURE_EXTRACTOR)) {
        var minerals = room.find(FIND_MINERALS);
        if(minerals.length && canCreateSite(room, minerals[0].pos, STRUCTURE_EXTRACTOR)) {
            addFutureSlots(visualPositions, seen, [minerals[0].pos], STRUCTURE_EXTRACTOR, limitState);
        }
    }

    for(var p = 0; p < visualPositions.length; p++) {
        drawPlannerSlot(room, visualPositions[p].pos, visualPositions[p].structureType, 0.16);
    }
}

function drawPlannerLegend(room, settings) {
    var debugSettings = debug.settings();
    var lines = [
        '[Construction Planner]',
        'solid square: existing',
        'dashed square: construction site',
        'circle/label: planned slot',
        'blue: road intent',
        'green: rampart/gate',
        'limit: ' + (debugSettings.debugConstructionPlannerLimit || 120)
    ];

    room.visual.rect(31.4, 0.4, 17.8, lines.length + 0.5, {
        fill: '#111111',
        opacity: 0.35,
        stroke: '#ffaa00',
        strokeWidth: 0.05
    });

    for(var i = 0; i < lines.length; i++) {
        room.visual.text(lines[i], 32, 1.2 + i, {
            align: 'left',
            color: i === 0 ? '#ffaa00' : '#ffffff',
            font: i === 0 ? 0.65 : 0.5,
            opacity: 0.9
        });
    }
}

function drawConstructionPlannerVisuals(room, settings) {
    if(!debug.enabled('debugConstructionPlanner')) {
        return;
    }

    drawAllocatedPlannerObjects(room);
    drawRoadPlannerVisuals(room, settings);
    drawFutureBuildingPlannerVisuals(room, settings);
    drawPlannerLegend(room, settings);
}

var constructionManager = {
    run: function(room) {
        if(!room.controller || !room.controller.my) {
            return;
        }

        var settings = room.memory.construction || {};
        updateWallTargetHits(room, settings);
        updateRoadReplanTargets(room, settings);

        planPriorityTowers(room, settings, 2);
        var maxTotalSites = settings.maxTotalSites || 20;
        var totalSites = room.find(FIND_CONSTRUCTION_SITES).length;

        if(totalSites >= maxTotalSites) {
            debug.log(
                'debugConstruction',
                room.name + ' construction planner paused: ' + totalSites + '/' + maxTotalSites + ' total sites',
                20
            );
            drawConstructionPlannerVisuals(room, settings);
            return;
        }

        if(shouldPrioritizeDefense(room, settings)) {
            debug.log('debugConstruction', room.name + ' prioritizing early defense sites', 10);
            var earlyDefensePlaced = planDefense(room, settings, maxTotalSites - totalSites);
            totalSites += earlyDefensePlaced;
        }

        var infrastructurePlaced = planInfrastructure(room, settings, maxTotalSites - totalSites);
        totalSites += infrastructurePlaced;

        if(totalSites < maxTotalSites) {
            planDefense(room, settings, maxTotalSites - totalSites);
        }

        drawConstructionPlannerVisuals(room, settings);
    }
};

module.exports = constructionManager;
