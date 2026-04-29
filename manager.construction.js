var debug = require('utils.debug');

var KEY_RAMPART_STRUCTURES = {};
KEY_RAMPART_STRUCTURES[STRUCTURE_SPAWN] = true;
KEY_RAMPART_STRUCTURES[STRUCTURE_EXTENSION] = true;
KEY_RAMPART_STRUCTURES[STRUCTURE_TOWER] = true;
KEY_RAMPART_STRUCTURES[STRUCTURE_STORAGE] = true;
KEY_RAMPART_STRUCTURES[STRUCTURE_TERMINAL] = true;

var BUILDING_STRUCTURES = {};
BUILDING_STRUCTURES[STRUCTURE_EXTENSION] = true;
BUILDING_STRUCTURES[STRUCTURE_TOWER] = true;
BUILDING_STRUCTURES[STRUCTURE_STORAGE] = true;
BUILDING_STRUCTURES[STRUCTURE_CONTAINER] = true;

function formatPos(pos) {
    return pos.roomName + ':' + pos.x + ',' + pos.y;
}

function getTerrain(room, x, y) {
    return room.getTerrain().get(x, y);
}

function isRoomEdge(pos) {
    return pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49;
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

    for(var i = 0; i < sources.length && placed < remaining; i++) {
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

        for(var j = 0; j < positions.length && placed < remaining; j++) {
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

function planRoads(room, remaining) {
    if(remaining <= 0) {
        return 0;
    }

    var spawn = getPrimarySpawn(room);
    if(!spawn) {
        return 0;
    }

    var placed = 0;
    var sources = room.find(FIND_SOURCES);
    for(var i = 0; i < sources.length && placed < remaining; i++) {
        placed += planRoadPath(room, spawn.pos, sources[i].pos, 1, remaining - placed);
    }

    if(room.controller && placed < remaining) {
        placed += planRoadPath(room, spawn.pos, room.controller.pos, 2, remaining - placed);
    }

    return placed;
}

function countDefenseConstructionSites(room) {
    return countConstructionSites(room, function(site) {
        return site.structureType == STRUCTURE_WALL ||
            site.structureType == STRUCTURE_RAMPART;
    });
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

    if(settings.autoRamparts === false && settings.autoExitWalls === false) {
        return false;
    }

    var minDefenseSites = settings.minDefenseSites || 4;
    return countDefenseConstructionSites(room) < minDefenseSites;
}

function countInfrastructureConstructionSites(room) {
    return countConstructionSites(room, function(site) {
        return !!BUILDING_STRUCTURES[site.structureType] ||
            site.structureType == STRUCTURE_ROAD;
    });
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

    if(settings.autoExtensions !== false && placed < remaining) {
        placed += planCoreStructure(room, STRUCTURE_EXTENSION, 2, 5, remaining - placed);
    }

    if(settings.autoTowers !== false && placed < remaining) {
        placed += planCoreStructure(room, STRUCTURE_TOWER, 2, 4, remaining - placed);
    }

    if(settings.autoStorage !== false && placed < remaining) {
        placed += planCoreStructure(room, STRUCTURE_STORAGE, 2, 4, remaining - placed);
    }

    if(settings.autoContainers !== false && placed < remaining) {
        placed += planSourceContainers(room, remaining - placed);
    }

    if(settings.autoRoads !== false && placed < remaining) {
        placed += planRoads(room, remaining - placed);
    }

    if(placed > 0) {
        debug.log('debugConstruction', room.name + ' placed ' + placed + ' infrastructure construction sites', 1);
    }

    return placed;
}

function planKeyRamparts(room, remaining) {
    var placed = 0;
    var structures = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return !!KEY_RAMPART_STRUCTURES[structure.structureType];
        }
    });

    structures.sort(function(a, b) {
        if(a.structureType == STRUCTURE_SPAWN && b.structureType != STRUCTURE_SPAWN) {
            return -1;
        }

        if(a.structureType != STRUCTURE_SPAWN && b.structureType == STRUCTURE_SPAWN) {
            return 1;
        }

        return a.pos.getRangeTo(room.controller || a.pos) - b.pos.getRangeTo(room.controller || b.pos);
    });

    for(var i = 0; i < structures.length && placed < remaining; i++) {
        var result = createSite(room, structures[i].pos, STRUCTURE_RAMPART);
        if(result == OK) {
            placed++;
        }

        if(result == ERR_FULL) {
            break;
        }
    }

    return placed;
}

function planCorePerimeterDefense(room, remaining) {
    var placed = 0;
    var spawn = getPrimarySpawn(room);
    if(!spawn) {
        return placed;
    }

    var candidates = [];
    for(var range = 1; range <= 2; range++) {
        for(var dx = -range; dx <= range; dx++) {
            for(var dy = -range; dy <= range; dy++) {
                if(Math.max(Math.abs(dx), Math.abs(dy)) != range) {
                    continue;
                }

                var x = spawn.pos.x + dx;
                var y = spawn.pos.y + dy;
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
        var controller = room.controller;
        var aScore = controller ? a.getRangeTo(controller) : 0;
        var bScore = controller ? b.getRangeTo(controller) : 0;
        return aScore - bScore;
    });

    for(var i = 0; i < candidates.length && placed < remaining; i++) {
        var result = createSite(room, candidates[i], STRUCTURE_RAMPART);
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
            room.name + ' planned ' + placed + ' fallback core defense site(s)',
            1
        );
    }

    return placed;
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

function getInteriorExitPos(room, pos) {
    if(pos.x === 0) {
        return new RoomPosition(1, pos.y, room.name);
    }

    if(pos.x === 49) {
        return new RoomPosition(48, pos.y, room.name);
    }

    if(pos.y === 0) {
        return new RoomPosition(pos.x, 1, room.name);
    }

    return new RoomPosition(pos.x, 48, room.name);
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
    var placed = 0;
    var gateIndex = Math.floor(segment.length / 2);

    for(var i = 0; i < segment.length && placed < remaining; i++) {
        var pos = getInteriorExitPos(room, segment[i]);
        var structureType = i == gateIndex ? STRUCTURE_RAMPART : STRUCTURE_WALL;
        var result = createSite(room, pos, structureType);

        if(result == OK) {
            placed++;
        }

        if(result == ERR_FULL) {
            break;
        }
    }

    return placed;
}

function planExitWalls(room, remaining) {
    var placed = 0;
    var segments = groupExitSegments(room);
    segments.sort(function(a, b) {
        return a.length - b.length;
    });

    for(var i = 0; i < segments.length && placed < remaining; i++) {
        placed += planExitSegment(room, segments[i], remaining - placed);
    }

    if(segments.length) {
        debug.log(
            'debugConstruction',
            room.name + ' exit wall planner scanned ' + segments.length + ' exit segments',
            20
        );
    }

    return placed;
}

function planDefense(room, settings, totalBudget) {
    if(!canPlanDefense(room, settings)) {
        return 0;
    }

    var maxDefenseSites = settings.maxDefenseSites || 12;
    var maxNewSites = settings.maxNewDefenseSitesPerTick || 3;
    var existingDefenseSites = countDefenseConstructionSites(room);
    var siteBudget = totalBudget === undefined ? maxNewSites : Math.min(maxNewSites, totalBudget);

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

    if(settings.autoRamparts !== false) {
        placed += planKeyRamparts(room, remaining - placed);
    }

    if(settings.autoExitWalls !== false && placed < remaining) {
        placed += planExitWalls(room, remaining - placed);
    }

    if(placed === 0 && placed < remaining) {
        placed += planCorePerimeterDefense(room, remaining - placed);
    }

    if(placed > 0) {
        debug.log('debugConstruction', room.name + ' placed ' + placed + ' defense construction sites', 1);
    }
    else if(settings.autoRamparts !== false || settings.autoExitWalls !== false) {
        debug.log(
            'debugConstruction',
            room.name + ' defense planner found no valid defense placements',
            10
        );
    }

    return placed;
}

var constructionManager = {
    run: function(room) {
        if(!room.controller || !room.controller.my) {
            return;
        }

        var settings = room.memory.construction || {};
        var maxTotalSites = settings.maxTotalSites || 20;
        var totalSites = room.find(FIND_CONSTRUCTION_SITES).length;

        if(totalSites >= maxTotalSites) {
            debug.log(
                'debugConstruction',
                room.name + ' construction planner paused: ' + totalSites + '/' + maxTotalSites + ' total sites',
                20
            );
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
    }
};

module.exports = constructionManager;
