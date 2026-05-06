var creepUtils = require('utils.creep');
var debug = require('utils.debug');
var defenseUtils = require('utils.defense');

var CONSTRUCTION_PRIORITY = {};
CONSTRUCTION_PRIORITY[STRUCTURE_TOWER] = 1;
CONSTRUCTION_PRIORITY[STRUCTURE_EXTENSION] = 2;
CONSTRUCTION_PRIORITY[STRUCTURE_CONTAINER] = 3;
CONSTRUCTION_PRIORITY[STRUCTURE_ROAD] = 4;
CONSTRUCTION_PRIORITY[STRUCTURE_STORAGE] = 5;
CONSTRUCTION_PRIORITY[STRUCTURE_RAMPART] = 6;
CONSTRUCTION_PRIORITY[STRUCTURE_WALL] = 7;

function getPriority(site) {
    return CONSTRUCTION_PRIORITY[site.structureType] || 99;
}

function formatPos(pos) {
    return pos.roomName + ':' + pos.x + ',' + pos.y;
}

function countSitesByType(sites, structureType) {
    var count = 0;
    for(var i = 0; i < sites.length; i++) {
        if(sites[i].structureType == structureType) {
            count++;
        }
    }

    return count;
}

function getIgnoredConstructionSites(room) {
    if(!room.memory.ignoredConstructionSites) {
        room.memory.ignoredConstructionSites = {};
    }

    var ignored = room.memory.ignoredConstructionSites;
    for(var siteId in ignored) {
        if(ignored[siteId] <= Game.time) {
            delete ignored[siteId];
        }
    }

    return ignored;
}

function isIgnoredConstructionSite(room, site) {
    if(!site.id) {
        return false;
    }

    var ignored = getIgnoredConstructionSites(room);
    return ignored[site.id] && ignored[site.id] > Game.time;
}

function ignoreConstructionSite(room, site, ticks) {
    if(!site.id) {
        return;
    }

    getIgnoredConstructionSites(room)[site.id] = Game.time + (ticks || 100);
}

function getConstructionReservations(room) {
    if(!room.memory.constructionReservations) {
        room.memory.constructionReservations = {};
    }

    var reservations = room.memory.constructionReservations;
    for(var siteId in reservations) {
        var creep = Game.creeps[reservations[siteId].creepName];
        var site = Game.getObjectById(siteId);
        if(!creep ||
            !site ||
            creep.memory.role != 'builder' ||
            creep.memory.constructionTargetId != siteId ||
            !creep.memory.working ||
            creep.store[RESOURCE_ENERGY] === 0 ||
            reservations[siteId].expires <= Game.time) {
            delete reservations[siteId];
            continue;
        }
    }

    return reservations;
}

function isReservedConstructionSite(room, site, creepName) {
    if(!site.id) {
        return false;
    }

    var reservations = getConstructionReservations(room);
    return reservations[site.id] &&
        reservations[site.id].creepName != creepName;
}

function reserveConstructionSite(creep, site) {
    if(!site || !site.id) {
        return;
    }

    var reservations = getConstructionReservations(creep.room);
    reservations[site.id] = {
        creepName: creep.name,
        expires: Game.time + 25
    };
    creep.memory.constructionTargetId = site.id;
}

function releaseConstructionReservation(creep) {
    var targetId = creep.memory.constructionTargetId;
    if(!targetId) {
        return;
    }

    if(creep.room &&
        creep.room.memory &&
        creep.room.memory.constructionReservations &&
        creep.room.memory.constructionReservations[targetId] &&
        creep.room.memory.constructionReservations[targetId].creepName == creep.name) {
        delete creep.room.memory.constructionReservations[targetId];
    }

    delete creep.memory.constructionTargetId;
}

function isEligibleConstructionSite(creep, site) {
    return site.my !== false &&
        !isIgnoredConstructionSite(creep.room, site) &&
        creepUtils.isSafeTarget(creep, site) &&
        defenseUtils.shouldBuildConstructionSite(site) &&
        creepUtils.canReachBeforeDecay(creep, site, 3);
}

function sortConstructionSites(sites) {
    sites.sort(function(a, b) {
        var priorityDiff = getPriority(a) - getPriority(b);
        if(priorityDiff !== 0) {
            return priorityDiff;
        }

        return (a.progressTotal - a.progress) - (b.progressTotal - b.progress);
    });
}

function findConstructionTarget(creep, sites, allowAssisting) {
    if(!sites.length) {
        return null;
    }

    allowAssisting = allowAssisting === true;

    var rememberedTarget = creep.memory.constructionTargetId ?
        Game.getObjectById(creep.memory.constructionTargetId) :
        null;
    if(rememberedTarget &&
        isEligibleConstructionSite(creep, rememberedTarget) &&
        !isReservedConstructionSite(creep.room, rememberedTarget, creep.name)) {
        reserveConstructionSite(creep, rememberedTarget);
        return rememberedTarget;
    }

    releaseConstructionReservation(creep);

    var eligibleSites = sites.filter(function(site) {
        return isEligibleConstructionSite(creep, site);
    });
    if(!eligibleSites.length) {
        debug.log('debugDefense', creep.name + ' found no safe construction sites', 5);
        return null;
    }

    var uniqueSites = eligibleSites.filter(function(site) {
        return !isReservedConstructionSite(creep.room, site, creep.name);
    });
    if(!uniqueSites.length && !allowAssisting) {
        return null;
    }

    var assisting = uniqueSites.length < 1;
    var targetSites = assisting ? eligibleSites : uniqueSites;
    sortConstructionSites(targetSites);

    debug.log(
        'debugRoles',
        creep.name + (assisting ? ' assisting build target ' : ' build target ') + targetSites[0].structureType +
            ' at ' + formatPos(targetSites[0].pos) +
            ' priority ' + getPriority(targetSites[0]) +
            ' progress ' + targetSites[0].progress + '/' + targetSites[0].progressTotal,
        3
    );

    if(!assisting) {
        reserveConstructionSite(creep, targetSites[0]);
    }

    return targetSites[0];
}

function findCriticalRepairTarget(creep) {
    var room = creep.room;
    var blockedTargetId = room.memory.towerRepairTargetId;
    var damaged = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            if(blockedTargetId && structure.id == blockedTargetId) {
                return false;
            }

            if(structure.structureType == STRUCTURE_WALL || structure.structureType == STRUCTURE_RAMPART) {
                return false;
            }

            return structure.hits < structure.hitsMax * 0.25 &&
                creepUtils.isSafeTarget(creep, structure) &&
                creepUtils.canReachBeforeDecay(creep, structure, 3);
        }
    });

    if(!damaged.length) {
        return null;
    }

    damaged.sort(function(a, b) {
        return (a.hits / a.hitsMax) - (b.hits / b.hitsMax);
    });

    return damaged[0];
}

function findWallRepairTarget(creep) {
    var room = creep.room;
    var targetHits = room.memory.wallTargetHits || 1000;
    var blockedTargetId = room.memory.towerRepairTargetId;
    var walls = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            if(blockedTargetId && structure.id == blockedTargetId) {
                return false;
            }

            return (structure.structureType == STRUCTURE_WALL ||
                structure.structureType == STRUCTURE_RAMPART) &&
                defenseUtils.shouldMaintainDefenseStructure(structure) &&
                structure.hits < targetHits &&
                creepUtils.isSafeTarget(creep, structure) &&
                creepUtils.canReachBeforeDecay(creep, structure, 3);
        }
    });

    if(!walls.length) {
        return null;
    }

    walls.sort(function(a, b) {
        return a.hits - b.hits;
    });

    return walls[0];
}

function hasWallRepairBacklog(room) {
    var targetHits = room.memory.wallTargetHits || 1000;
    var walls = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            return (structure.structureType == STRUCTURE_WALL ||
                structure.structureType == STRUCTURE_RAMPART) &&
                defenseUtils.shouldMaintainDefenseStructure(structure) &&
                structure.hits < targetHits;
        }
    });

    return walls.length > 0;
}

function hasHostileThreats(room) {
    var hostiles = room.find(FIND_HOSTILE_CREEPS, {
        filter: function(creep) {
            return creep.getActiveBodyparts(ATTACK) > 0 ||
                creep.getActiveBodyparts(RANGED_ATTACK) > 0 ||
                creep.getActiveBodyparts(WORK) > 0 ||
                creep.getActiveBodyparts(CLAIM) > 0;
        }
    });

    return hostiles.length > 0;
}

function getActiveBuilderNames(room) {
    var names = [];
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(creep.room.name == room.name &&
            creep.memory.role == 'builder' &&
            !creep.spawning) {
            names.push(name);
        }
    }

    names.sort();
    return names;
}

function canRepairWalls(creep) {
    if(creep.room.memory.defenseMode || hasHostileThreats(creep.room)) {
        return true;
    }

    var builders = getActiveBuilderNames(creep.room);
    if(builders.length <= 1) {
        return true;
    }

    var configuredLimit = creep.room.memory.maxWallRepairBuilders;
    var maxWallRepairers = typeof configuredLimit == 'number' ?
        Math.max(0, Math.min(builders.length, configuredLimit)) :
        1;

    return builders.indexOf(creep.name) >= 0 &&
        builders.indexOf(creep.name) < maxWallRepairers;
}

function findMaintenanceRepairTarget(creep) {
    var room = creep.room;
    var blockedTargetId = room.memory.towerRepairTargetId;
    var damaged = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            if(blockedTargetId && structure.id == blockedTargetId) {
                return false;
            }

            if(!creepUtils.isSafeTarget(creep, structure)) {
                return false;
            }

            if(!creepUtils.canReachBeforeDecay(creep, structure, 3)) {
                return false;
            }

            if(structure.structureType == STRUCTURE_ROAD) {
                return structure.hits < structure.hitsMax * 0.5;
            }

            if(structure.structureType == STRUCTURE_CONTAINER) {
                return structure.hits < structure.hitsMax * 0.7;
            }

            if(structure.structureType == STRUCTURE_WALL || structure.structureType == STRUCTURE_RAMPART) {
                return false;
            }

            return structure.hits < structure.hitsMax;
        }
    });

    if(!damaged.length) {
        return null;
    }

    damaged.sort(function(a, b) {
        return (a.hits / a.hitsMax) - (b.hits / b.hitsMax);
    });

    return damaged[0];
}

function findRepairTarget(creep, allowWallRepair) {
    return findCriticalRepairTarget(creep) ||
        (allowWallRepair ? findWallRepairTarget(creep) : null) ||
        findMaintenanceRepairTarget(creep);
}

function build(creep, target) {
    if(!creepUtils.canReachBeforeDecay(creep, target, 3)) {
        debug.log('debugRoles', creep.name + ' skipped construction target that will decay before arrival', 5);
        return false;
    }

    var result = creep.build(target);
    if(result == ERR_NOT_IN_RANGE) {
        debug.log(
            'debugRoles',
            creep.name + ' moving to build ' + target.structureType + ' at ' + formatPos(target.pos),
            5
        );
        creepUtils.moveTo(creep, target, '#ffffff', 'go build', 'move:build');
        return true;
    }

    if(result == OK) {
        creepUtils.announceIntent(creep, 'action:build', 'build');
        debug.log(
            'debugRoles',
            creep.name + ' building ' + target.structureType + ' at ' + formatPos(target.pos),
            3
        );
        return true;
    }

    debug.log('debugRoles', creep.name + ' build failed for ' + target.structureType + ': ' + result, 1);
    if(result == ERR_INVALID_TARGET ||
        (typeof ERR_RCL_NOT_ENOUGH != 'undefined' && result == ERR_RCL_NOT_ENOUGH)) {
        ignoreConstructionSite(creep.room, target, 100);
        debug.log(
            'debugRoles',
            creep.name + ' temporarily ignoring invalid construction target at ' + formatPos(target.pos),
            1
        );
    }

    return result == OK;
}

function repair(creep, target) {
    if(!creepUtils.canReachBeforeDecay(creep, target, 3)) {
        debug.log('debugRoles', creep.name + ' skipped repair target that will decay before arrival', 5);
        return false;
    }

    var result = creep.repair(target);
    if(result == ERR_NOT_IN_RANGE) {
        creepUtils.moveTo(creep, target, '#ffffff', 'go repair', 'move:repair');
        return true;
    }

    if(result == OK) {
        creepUtils.announceIntent(creep, 'action:repair', 'repair');
        return true;
    }

    return result == OK;
}

function getRoadReplanTargets(room) {
    if(!room.memory.roadReplanTargets) {
        return [];
    }

    var targets = [];
    var nextIds = [];
    for(var i = 0; i < room.memory.roadReplanTargets.length; i++) {
        var target = Game.getObjectById(room.memory.roadReplanTargets[i]);
        if(!target || target.room.name != room.name) {
            continue;
        }

        targets.push(target);
        nextIds.push(target.id);
    }

    room.memory.roadReplanTargets = nextIds;
    return targets;
}

function findRoadReplanTarget(creep) {
    if(creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0 ||
        creep.getActiveBodyparts(WORK) === 0 ||
        creep.room.memory.defenseMode ||
        hasHostileThreats(creep.room)) {
        return null;
    }

    var targets = getRoadReplanTargets(creep.room).filter(function(target) {
        return creepUtils.isSafeTarget(creep, target) &&
            creepUtils.canReachBeforeDecay(creep, target, 1);
    });

    if(!targets.length) {
        return null;
    }

    targets.sort(function(a, b) {
        return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b) ||
            a.hits - b.hits;
    });

    return targets[0];
}

function dismantleRoadReplanTarget(creep, target) {
    if(!creepUtils.canReachBeforeDecay(creep, target, 1)) {
        debug.log('debugRoles', creep.name + ' skipped road replan target that will decay before arrival', 5);
        return false;
    }

    var result = creep.dismantle(target);
    if(result == ERR_NOT_IN_RANGE) {
        debug.log(
            'debugRoles',
            creep.name + ' moving to clear misplaced ' + target.structureType +
                ' at ' + formatPos(target.pos),
            5
        );
        creepUtils.moveTo(creep, target, '#ffcc66', 'clear road', 'move:roadReplan');
        return true;
    }

    if(result == OK) {
        creepUtils.announceIntent(creep, 'action:roadReplan', 'clear');
        debug.log(
            'debugRoles',
            creep.name + ' dismantling misplaced ' + target.structureType +
                ' for road replan at ' + formatPos(target.pos),
            3
        );
        return true;
    }

    debug.log('debugRoles', creep.name + ' road replan dismantle failed: ' + result, 5);
    return false;
}

function isSamePos(pos, memoryPos) {
    return memoryPos &&
        pos.x == memoryPos.x &&
        pos.y == memoryPos.y &&
        pos.roomName == memoryPos.roomName;
}

function isWalkable(creep, pos) {
    if(pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49) {
        return false;
    }

    if(creep.room.getTerrain().get(pos.x, pos.y) == TERRAIN_MASK_WALL) {
        return false;
    }

    if(pos.lookFor(LOOK_CREEPS).length > 0) {
        return false;
    }

    var structures = pos.lookFor(LOOK_STRUCTURES);
    for(var i = 0; i < structures.length; i++) {
        var type = structures[i].structureType;
        if(type != STRUCTURE_ROAD &&
            type != STRUCTURE_CONTAINER &&
            type != STRUCTURE_RAMPART) {
            return false;
        }
    }

    return true;
}

function getSourceRange(pos, harvestPos) {
    if(!harvestPos.sourceRoomName) {
        return 0;
    }

    var sourcePos = new RoomPosition(harvestPos.sourceX, harvestPos.sourceY, harvestPos.sourceRoomName);
    return pos.getRangeTo(sourcePos);
}

function findStepOffPosition(creep, harvestPos) {
    var candidates = [];
    for(var dx = -1; dx <= 1; dx++) {
        for(var dy = -1; dy <= 1; dy++) {
            if(dx === 0 && dy === 0) {
                continue;
            }

            var x = creep.pos.x + dx;
            var y = creep.pos.y + dy;
            if(x <= 0 || x >= 49 || y <= 0 || y >= 49) {
                continue;
            }

            var pos = new RoomPosition(x, y, creep.room.name);
            if(isWalkable(creep, pos)) {
                candidates.push(pos);
            }
        }
    }

    candidates.sort(function(a, b) {
        var sourceRangeDiff = getSourceRange(b, harvestPos) - getSourceRange(a, harvestPos);
        if(sourceRangeDiff !== 0) {
            return sourceRangeDiff;
        }

        var controller = creep.room.controller;
        if(controller) {
            return a.getRangeTo(controller) - b.getRangeTo(controller);
        }

        return 0;
    });

    return candidates[0] || null;
}

function moveOffHarvestPosition(creep) {
    var harvestPos = creep.memory.lastHarvestPosition;
    if(!isSamePos(creep.pos, harvestPos)) {
        return false;
    }

    var stepOffPos = findStepOffPosition(creep, harvestPos);
    if(!stepOffPos) {
        debug.log('debugRoles', creep.name + ' cannot find a tile to clear harvest position ' + formatPos(creep.pos), 5);
        return false;
    }

    debug.log(
        'debugRoles',
        creep.name + ' clearing harvest tile ' + formatPos(creep.pos) + ' -> ' + formatPos(stepOffPos),
        1
    );
    creepUtils.moveTo(creep, stepOffPos, '#66ff66', 'clear src', 'move:clearHarvest');
    return true;
}

var roleBuilder = {
    run: function(creep) {
        creepUtils.updateWorkingState(creep, 'build', 'energy');

        var sites = creep.room.find(FIND_CONSTRUCTION_SITES);
        var extensionSites = countSitesByType(sites, STRUCTURE_EXTENSION);
        var towerSites = countSitesByType(sites, STRUCTURE_TOWER);
        debug.log(
            'debugRoles',
            creep.name + ' builder state working=' + creep.memory.working +
                ' energy=' + creep.store[RESOURCE_ENERGY] + '/' + creep.store.getCapacity(RESOURCE_ENERGY) +
                ' sites=' + sites.length +
                ' extensions=' + extensionSites +
                ' towers=' + towerSites,
            5
        );

        if(!creep.memory.working) {
            releaseConstructionReservation(creep);
            debug.log('debugRoles', creep.name + ' gathering energy before building', 10);
            creepUtils.collectEnergy(creep);
            return;
        }

        if(moveOffHarvestPosition(creep)) {
            return;
        }

        var constructionTarget = findConstructionTarget(creep, sites, false);
        if(constructionTarget) {
            if(!build(creep, constructionTarget)) {
                releaseConstructionReservation(creep);
            }
            return;
        }

        releaseConstructionReservation(creep);

        var criticalRepairTarget = findCriticalRepairTarget(creep);
        if(criticalRepairTarget) {
            debug.log(
                'debugRoles',
                creep.name + ' critical repair target ' + criticalRepairTarget.structureType +
                    ' in ' + creep.room.name,
                5
            );
            repair(creep, criticalRepairTarget);
            return;
        }

        constructionTarget = findConstructionTarget(creep, sites, true);
        if(constructionTarget) {
            if(!build(creep, constructionTarget)) {
                releaseConstructionReservation(creep);
            }
            return;
        }

        releaseConstructionReservation(creep);

        var allowWallRepair = canRepairWalls(creep);
        var repairTarget = findRepairTarget(creep, allowWallRepair);
        if(repairTarget) {
            debug.log('debugRoles', creep.name + ' repair target ' + repairTarget.structureType + ' in ' + creep.room.name, 10);
            repair(creep, repairTarget);
            return;
        }

        var roadReplanTarget = findRoadReplanTarget(creep);
        if(roadReplanTarget && dismantleRoadReplanTarget(creep, roadReplanTarget)) {
            return;
        }

        if(!allowWallRepair && hasWallRepairBacklog(creep.room)) {
            debug.log(
                'debugRoles',
                creep.name + ' leaving wall repairs to assigned builder; upgrading to unlock expansion',
                10
            );
        }

        debug.log('debugRoles', creep.name + ' has no build or repair work; upgrading controller', 10);
        creepUtils.upgrade(creep);
    }
};

module.exports = roleBuilder;
