var debug = require('utils.debug');

function findRepairTarget(room) {
    var wallTargetHits = room.memory.wallTargetHits || 1000;
    var critical = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            if(structure.structureType == STRUCTURE_WALL || structure.structureType == STRUCTURE_RAMPART) {
                return structure.hits < wallTargetHits * 0.5;
            }

            if(structure.structureType == STRUCTURE_ROAD) {
                return structure.hits < structure.hitsMax * 0.5;
            }

            if(structure.structureType == STRUCTURE_CONTAINER) {
                return structure.hits < structure.hitsMax * 0.7;
            }

            return structure.hits < structure.hitsMax * 0.25;
        }
    });

    if(!critical.length) {
        return null;
    }

    critical.sort(function(a, b) {
        if(a.structureType == STRUCTURE_WALL || a.structureType == STRUCTURE_RAMPART) {
            return a.hits - b.hits;
        }

        return (a.hits / a.hitsMax) - (b.hits / b.hitsMax);
    });

    return critical[0];
}

function isThreateningHostile(creep) {
    return creep.getActiveBodyparts(ATTACK) > 0 ||
        creep.getActiveBodyparts(RANGED_ATTACK) > 0 ||
        creep.getActiveBodyparts(WORK) > 0 ||
        creep.getActiveBodyparts(CLAIM) > 0;
}

function findThreateningHostiles(hostiles) {
    var threats = [];
    for(var i = 0; i < hostiles.length; i++) {
        if(isThreateningHostile(hostiles[i])) {
            threats.push(hostiles[i]);
        }
    }

    return threats;
}

function canActivateSafeMode(room) {
    if(!room.controller || !room.controller.my) {
        return false;
    }

    if(room.controller.safeMode || room.controller.safeModeCooldown) {
        return false;
    }

    return room.controller.safeModeAvailable > 0;
}

function activateSafeModeIfNeeded(room, hostiles) {
    var threats = findThreateningHostiles(hostiles);
    if(!threats.length) {
        return;
    }

    room.memory.lastThreatTick = Game.time;

    if(!canActivateSafeMode(room)) {
        debug.log(
            'debugDefense',
            room.name + ' safe mode unavailable for ' + threats.length + ' threat(s)',
            25
        );
        return;
    }

    if(room.memory.lastSafeModeAttempt &&
        Game.time - room.memory.lastSafeModeAttempt < 20) {
        return;
    }

    room.memory.lastSafeModeAttempt = Game.time;
    var result = room.controller.activateSafeMode();
    if(result == OK) {
        room.memory.lastSafeModeActivated = Game.time;
        debug.log(
            'debugDefense',
            room.name + ' activated safe mode against ' + threats.length + ' threat(s)',
            1
        );
        return;
    }

    debug.log(
        'debugDefense',
        room.name + ' failed to activate safe mode: ' + result,
        5
    );
}

var towerManager = {
    run: function(room) {
        var hostiles = room.find(FIND_HOSTILE_CREEPS);
        room.memory.defenseMode = hostiles.length > 0;

        if(hostiles.length) {
            debug.log('debugDefense', room.name + ' hostile alert: ' + hostiles.length, 1);
            activateSafeModeIfNeeded(room, hostiles);
        }

        var towers = room.find(FIND_MY_STRUCTURES, {
            filter: function(structure) {
                return structure.structureType == STRUCTURE_TOWER;
            }
        });

        if(!towers.length) {
            return;
        }

        for(var i = 0; i < towers.length; i++) {
            var tower = towers[i];

            if(hostiles.length) {
                var hostile = tower.pos.findClosestByRange(hostiles);
                if(hostile) {
                    tower.attack(hostile);
                    debug.log('debugDefense', tower.id + ' attacking hostile in ' + room.name, 3);
                }
                continue;
            }

            var injured = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
                filter: function(creep) {
                    return creep.hits < creep.hitsMax;
                }
            });

            if(injured) {
                tower.heal(injured);
                debug.log('debugDefense', tower.id + ' healing ' + injured.name, 5);
                continue;
            }

            if(tower.store[RESOURCE_ENERGY] < 600) {
                continue;
            }

            var repairTarget = findRepairTarget(room);
            if(repairTarget) {
                tower.repair(repairTarget);
                debug.log('debugDefense', tower.id + ' repairing ' + repairTarget.structureType, 10);
            }
        }
    }
};

module.exports = towerManager;
