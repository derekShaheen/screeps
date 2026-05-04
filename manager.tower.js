var debug = require('utils.debug');
var defenseUtils = require('utils.defense');

var DEFENSE_MODE_MEMORY_TICKS = 50;

function formatPos(pos) {
    return pos.roomName + ':' + pos.x + ',' + pos.y;
}

function getTowerAttackEnergyCost() {
    if(typeof TOWER_ENERGY_COST == 'number') {
        return TOWER_ENERGY_COST;
    }

    return 10;
}

function isActiveTower(tower) {
    return !tower.isActive || tower.isActive();
}

function findRepairTarget(room) {
    var wallTargetHits = room.memory.wallTargetHits || 1000;
    var critical = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            if(structure.structureType == STRUCTURE_WALL || structure.structureType == STRUCTURE_RAMPART) {
                return defenseUtils.shouldMaintainDefenseStructure(structure) &&
                    structure.hits < wallTargetHits * 0.5;
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

function getPrimaryTower(towers) {
    if(!towers.length) {
        return null;
    }

    towers.sort(function(a, b) {
        return b.store[RESOURCE_ENERGY] - a.store[RESOURCE_ENERGY];
    });

    return towers[0];
}

function getHostilePriority(hostile) {
    var priority = 0;

    priority += hostile.getActiveBodyparts(HEAL) * 60;
    priority += hostile.getActiveBodyparts(RANGED_ATTACK) * 50;
    priority += hostile.getActiveBodyparts(ATTACK) * 45;
    priority += hostile.getActiveBodyparts(WORK) * 25;
    priority += hostile.getActiveBodyparts(CLAIM) * 20;

    if(priority === 0) {
        priority = 1;
    }

    return priority;
}

function getTowerTargetScore(primaryTower, spawn, hostile) {
    var towerRange = primaryTower ? primaryTower.pos.getRangeTo(hostile) : 50;
    var spawnRange = spawn ? hostile.pos.getRangeTo(spawn) : 50;

    return getHostilePriority(hostile) * 1000 -
        hostile.hits -
        towerRange * 10 -
        spawnRange * 5;
}

function getRememberedTowerTarget(room, hostiles) {
    if(!room.memory.towerTargetId) {
        return null;
    }

    for(var i = 0; i < hostiles.length; i++) {
        if(hostiles[i].id == room.memory.towerTargetId) {
            return hostiles[i];
        }
    }

    delete room.memory.towerTargetId;
    return null;
}

function findTowerAttackTarget(room, towers, hostiles) {
    if(!hostiles.length) {
        delete room.memory.towerTargetId;
        return null;
    }

    var primaryTower = getPrimaryTower(towers);
    var spawn = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    })[0] || null;

    var remembered = getRememberedTowerTarget(room, hostiles);
    hostiles.sort(function(a, b) {
        return getTowerTargetScore(primaryTower, spawn, b) -
            getTowerTargetScore(primaryTower, spawn, a);
    });

    if(remembered && remembered.hits > 0) {
        var rememberedScore = getTowerTargetScore(primaryTower, spawn, remembered);
        var bestScore = getTowerTargetScore(primaryTower, spawn, hostiles[0]);
        if(rememberedScore + 1000 >= bestScore) {
            return remembered;
        }
    }

    room.memory.towerTargetId = hostiles[0].id;
    return hostiles[0];
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
        if(hostiles.length > 0) {
            room.memory.lastHostileSeenTick = Game.time;
        }

        room.memory.defenseMode = hostiles.length > 0 ||
            (room.memory.lastHostileSeenTick &&
                Game.time - room.memory.lastHostileSeenTick <= DEFENSE_MODE_MEMORY_TICKS);

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

        var activeTowers = [];
        for(var towerIndex = 0; towerIndex < towers.length; towerIndex++) {
            if(isActiveTower(towers[towerIndex])) {
                activeTowers.push(towers[towerIndex]);
                continue;
            }

            debug.log(
                'debugDefense',
                towers[towerIndex].id + ' tower inactive at RCL ' +
                    (room.controller ? room.controller.level : 'none') +
                    ' energy ' + towers[towerIndex].store[RESOURCE_ENERGY],
                5
            );
        }

        if(!activeTowers.length) {
            return;
        }

        var attackTarget = findTowerAttackTarget(room, activeTowers, hostiles);

        for(var i = 0; i < activeTowers.length; i++) {
            var tower = activeTowers[i];

            if(attackTarget) {
                var attackResult = tower.attack(attackTarget);
                if(attackResult == OK) {
                    debug.log(
                        'debugDefense',
                        tower.id + ' attacking ' + attackTarget.owner.username +
                            ' hostile at ' + formatPos(attackTarget.pos) +
                            ' hits ' + attackTarget.hits + '/' + attackTarget.hitsMax,
                        3
                    );
                    continue;
                }

                if(tower.store[RESOURCE_ENERGY] < getTowerAttackEnergyCost()) {
                    debug.log(
                        'debugDefense',
                        tower.id + ' cannot attack; energy ' +
                            tower.store[RESOURCE_ENERGY] + '/' + getTowerAttackEnergyCost(),
                        5
                    );
                    continue;
                }

                debug.log(
                    'debugDefense',
                    tower.id + ' attack failed: ' + attackResult +
                        ' target ' + attackTarget.owner.username +
                        ' at ' + formatPos(attackTarget.pos) +
                        (attackResult == ERR_RCL_NOT_ENOUGH ? ' tower inactive for current RCL' : ''),
                    3
                );
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
