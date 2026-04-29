var creepUtils = require('utils.creep');
var debug = require('utils.debug');

var CONSTRUCTION_PRIORITY = {};
CONSTRUCTION_PRIORITY[STRUCTURE_EXTENSION] = 1;
CONSTRUCTION_PRIORITY[STRUCTURE_TOWER] = 2;
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

function findConstructionTarget(creep, sites) {
    if(!sites.length) {
        return null;
    }

    sites = sites.filter(function(site) {
        return creepUtils.isSafeTarget(creep, site);
    });
    if(!sites.length) {
        debug.log('debugDefense', creep.name + ' found no safe construction sites', 5);
        return null;
    }

    sites.sort(function(a, b) {
        var priorityDiff = getPriority(a) - getPriority(b);
        if(priorityDiff !== 0) {
            return priorityDiff;
        }

        return (a.progressTotal - a.progress) - (b.progressTotal - b.progress);
    });

    debug.log(
        'debugRoles',
        creep.name + ' build target ' + sites[0].structureType +
            ' at ' + formatPos(sites[0].pos) +
            ' priority ' + getPriority(sites[0]) +
            ' progress ' + sites[0].progress + '/' + sites[0].progressTotal,
        3
    );
    return sites[0];
}

function findCriticalRepairTarget(creep) {
    var room = creep.room;
    var damaged = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            if(structure.structureType == STRUCTURE_WALL || structure.structureType == STRUCTURE_RAMPART) {
                return false;
            }

            return structure.hits < structure.hitsMax * 0.25 &&
                creepUtils.isSafeTarget(creep, structure);
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
    var walls = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            return (structure.structureType == STRUCTURE_WALL ||
                structure.structureType == STRUCTURE_RAMPART) &&
                structure.hits < targetHits &&
                creepUtils.isSafeTarget(creep, structure);
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

function findMaintenanceRepairTarget(creep) {
    var room = creep.room;
    var damaged = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            if(!creepUtils.isSafeTarget(creep, structure)) {
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

function findRepairTarget(creep) {
    return findCriticalRepairTarget(creep) ||
        findWallRepairTarget(creep) ||
        findMaintenanceRepairTarget(creep);
}

function build(creep, target) {
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
    return result == OK;
}

function repair(creep, target) {
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
        debug.log(
            'debugRoles',
            creep.name + ' builder state working=' + creep.memory.working +
                ' energy=' + creep.store[RESOURCE_ENERGY] + '/' + creep.store.getCapacity(RESOURCE_ENERGY) +
                ' sites=' + sites.length +
                ' extensions=' + extensionSites,
            5
        );

        if(!creep.memory.working) {
            debug.log('debugRoles', creep.name + ' gathering energy before building', 10);
            creepUtils.collectEnergy(creep);
            return;
        }

        if(moveOffHarvestPosition(creep)) {
            return;
        }

        var constructionTarget = findConstructionTarget(creep, sites);
        if(constructionTarget) {
            build(creep, constructionTarget);
            return;
        }

        var repairTarget = findRepairTarget(creep);
        if(repairTarget) {
            debug.log('debugRoles', creep.name + ' repair target ' + repairTarget.structureType + ' in ' + creep.room.name, 10);
            repair(creep, repairTarget);
            return;
        }

        debug.log('debugRoles', creep.name + ' has no build or repair work; upgrading controller', 10);
        creepUtils.upgrade(creep);
    }
};

module.exports = roleBuilder;
