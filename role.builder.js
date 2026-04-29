var creepUtils = require('utils.creep');
var debug = require('utils.debug');

var CONSTRUCTION_PRIORITY = {};
CONSTRUCTION_PRIORITY[STRUCTURE_EXTENSION] = 1;
CONSTRUCTION_PRIORITY[STRUCTURE_ROAD] = 2;
CONSTRUCTION_PRIORITY[STRUCTURE_TOWER] = 3;
CONSTRUCTION_PRIORITY[STRUCTURE_CONTAINER] = 4;
CONSTRUCTION_PRIORITY[STRUCTURE_RAMPART] = 5;
CONSTRUCTION_PRIORITY[STRUCTURE_WALL] = 6;

function getPriority(site) {
    return CONSTRUCTION_PRIORITY[site.structureType] || 99;
}

function findConstructionTarget(creep) {
    var sites = creep.room.find(FIND_CONSTRUCTION_SITES);
    if(!sites.length) {
        return null;
    }

    sites.sort(function(a, b) {
        var priorityDiff = getPriority(a) - getPriority(b);
        if(priorityDiff !== 0) {
            return priorityDiff;
        }

        return (a.progressTotal - a.progress) - (b.progressTotal - b.progress);
    });

    debug.log('debugRoles', creep.name + ' build target ' + sites[0].structureType + ' in ' + creep.room.name, 10);
    return sites[0];
}

function findCriticalRepairTarget(room) {
    var damaged = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            if(structure.structureType == STRUCTURE_WALL || structure.structureType == STRUCTURE_RAMPART) {
                return false;
            }

            return structure.hits < structure.hitsMax * 0.25;
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

function findWallRepairTarget(room) {
    var targetHits = room.memory.wallTargetHits || 1000;
    var walls = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            return (structure.structureType == STRUCTURE_WALL ||
                structure.structureType == STRUCTURE_RAMPART) &&
                structure.hits < targetHits;
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

function findMaintenanceRepairTarget(room) {
    var damaged = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
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

function findRepairTarget(room) {
    return findCriticalRepairTarget(room) ||
        findWallRepairTarget(room) ||
        findMaintenanceRepairTarget(room);
}

function build(creep, target) {
    var result = creep.build(target);
    if(result == ERR_NOT_IN_RANGE) {
        creepUtils.moveTo(creep, target, '#ffffff');
        return true;
    }

    return result == OK;
}

function repair(creep, target) {
    var result = creep.repair(target);
    if(result == ERR_NOT_IN_RANGE) {
        creepUtils.moveTo(creep, target, '#ffffff');
        return true;
    }

    return result == OK;
}

var roleBuilder = {
    run: function(creep) {
        creepUtils.updateWorkingState(creep, 'build', 'energy');

        if(!creep.memory.working) {
            creepUtils.collectEnergy(creep);
            return;
        }

        var constructionTarget = findConstructionTarget(creep);
        if(constructionTarget) {
            build(creep, constructionTarget);
            return;
        }

        var repairTarget = findRepairTarget(creep.room);
        if(repairTarget) {
            debug.log('debugRoles', creep.name + ' repair target ' + repairTarget.structureType + ' in ' + creep.room.name, 10);
            repair(creep, repairTarget);
            return;
        }

        creepUtils.upgrade(creep);
    }
};

module.exports = roleBuilder;
