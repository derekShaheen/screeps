var creepUtils = require('utils.creep');
var debug = require('utils.debug');
var remoteManager = require('manager.remote');

function formatPos(pos) {
    return pos.roomName + ':' + pos.x + ',' + pos.y;
}

function getRoomCenter(roomName) {
    return new RoomPosition(25, 25, roomName);
}

function getHomeFallback(creep) {
    var homeRoom = Game.rooms[creep.memory.homeRoom];
    if(!homeRoom) {
        return getRoomCenter(creep.memory.homeRoom);
    }

    var spawns = homeRoom.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });

    return spawns[0] || homeRoom.controller || getRoomCenter(homeRoom.name);
}

function retreatHome(creep, reason) {
    if(creep.room.name == creep.memory.targetRoom) {
        remoteManager.markUnsafe(creep.memory.homeRoom, creep.memory.targetRoom, reason || 'hostile threat');
    }
    creepUtils.announceIntent(creep, 'action:remoteRetreat', 'retreat');
    creepUtils.moveTo(creep, getHomeFallback(creep), '#ff66cc', 'home', 'move:remoteRetreat');
    return true;
}

function abortBlockedRemote(creep) {
    delete creep.memory.sourceId;
    creepUtils.announceIntent(creep, 'action:remoteAbort', 'blocked');
    creepUtils.moveTo(creep, getHomeFallback(creep), '#ff66cc', 'blocked', 'move:remoteBlocked');
    return true;
}

function convertToHomeHarvester(creep, reason) {
    var targetRoom = creep.memory.targetRoom;
    var homeRoom = creep.memory.homeRoom;

    creep.memory.role = 'harvester';
    creep.memory.working = creep.store[RESOURCE_ENERGY] > 0;
    creep.memory.previousRemoteRole = {
        role: 'remoteMiner',
        targetRoom: targetRoom,
        reason: reason || 'remote blocked',
        tick: Game.time
    };

    delete creep.memory.targetRoom;
    delete creep.memory.sourceId;
    delete creep.memory.containerSourceId;
    delete creep.memory.harvestSourceId;
    delete creep.memory.moveState;

    debug.log(
        'debugRoles',
        creep.name + ' converted from remoteMiner to local harvester in ' +
            creep.room.name + ' after ' + (reason || 'remote blocked') +
            (targetRoom ? ' for ' + targetRoom : '') +
            (homeRoom ? ' home=' + homeRoom : ''),
        1
    );
    creepUtils.announceIntent(creep, 'state:homeHarvester', 'local');
    return true;
}

function workAtHomeAfterBlocked(creep, reason) {
    var homeRoom = Game.rooms[creep.memory.homeRoom];
    if(!homeRoom || creep.room.name != homeRoom.name) {
        delete creep.memory.sourceId;
        creepUtils.announceIntent(creep, 'action:remoteAbort', 'blocked');
        creepUtils.moveTo(creep, getHomeFallback(creep), '#ff66cc', 'blocked', 'move:remoteBlocked');
        return true;
    }

    if(!homeRoom.controller || !homeRoom.controller.my) {
        return abortBlockedRemote(creep);
    }

    return convertToHomeHarvester(creep, reason);
}

function deliverIfReturningHome(creep) {
    if(creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
        return false;
    }

    if(!creep.memory.working) {
        return false;
    }

    return remoteManager.deliverHome(creep);
}

function moveToTargetRoom(creep) {
    remoteManager.moveToRoom(creep, creep.memory.targetRoom, '#ffaa00', 'remote', 'move:remoteRoom');
    return true;
}

function getOwnedUsername(creep) {
    if(creep.owner) {
        return creep.owner.username;
    }

    for(var name in Game.spawns) {
        return Game.spawns[name].owner.username;
    }

    return null;
}

function canBuildRemoteInfrastructure(creep) {
    if(!creep.room.controller || creep.room.controller.owner || creep.room.controller.my) {
        return false;
    }

    if(!creep.room.controller.reservation) {
        return true;
    }

    return creep.room.controller.reservation.username == getOwnedUsername(creep);
}

function chooseSource(creep) {
    if(creep.memory.sourceId) {
        var remembered = Game.getObjectById(creep.memory.sourceId);
        if(remembered) {
            return remembered;
        }

        if(creep.room.name != creep.memory.targetRoom) {
            return null;
        }

        delete creep.memory.sourceId;
    }

    var sources = creep.room.find(FIND_SOURCES);
    if(!sources.length) {
        return null;
    }

    sources.sort(function(a, b) {
        return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
    });

    creep.memory.sourceId = sources[0].id;
    return sources[0];
}

function getSourceContainer(source) {
    var containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_CONTAINER;
        }
    });

    containers.sort(function(a, b) {
        return a.pos.getRangeTo(source) - b.pos.getRangeTo(source);
    });

    return containers[0] || null;
}

function getContainerSite(source) {
    var sites = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
        filter: function(site) {
            return site.structureType == STRUCTURE_CONTAINER && site.my !== false;
        }
    });

    sites.sort(function(a, b) {
        return a.pos.getRangeTo(source) - b.pos.getRangeTo(source);
    });

    return sites[0] || null;
}

function getAnyOrphanedContainerSite(room) {
    var sites = room.find(FIND_CONSTRUCTION_SITES, {
        filter: function(site) {
            return site.structureType == STRUCTURE_CONTAINER && site.my !== false;
        }
    });

    var sources = room.find(FIND_SOURCES);
    var orphaned = sites.filter(function(site) {
        return sources.every(function(src) {
            return site.pos.getRangeTo(src) > 1;
        });
    });

    return orphaned[0] || null;
}

function isBuildableContainerPos(room, pos) {
    if(pos.x <= 1 || pos.x >= 48 || pos.y <= 1 || pos.y >= 48) {
        return false;
    }

    var terrain = (Game.rooms[pos.roomName] || room).getTerrain();
    if(terrain.get(pos.x, pos.y) & TERRAIN_MASK_WALL) {
        return false;
    }

    var structures = pos.lookFor(LOOK_STRUCTURES);
    for(var i = 0; i < structures.length; i++) {
        if(structures[i].structureType != STRUCTURE_ROAD &&
            structures[i].structureType != STRUCTURE_RAMPART) {
            return false;
        }
    }

    return pos.lookFor(LOOK_CONSTRUCTION_SITES).length === 0;
}

function chooseContainerPos(creep, source) {
    var positions = [];

    for(var dx = -1; dx <= 1; dx++) {
        for(var dy = -1; dy <= 1; dy++) {
            if(dx === 0 && dy === 0) {
                continue;
            }

            var pos = new RoomPosition(source.pos.x + dx, source.pos.y + dy, source.pos.roomName);
            if(isBuildableContainerPos(creep.room, pos)) {
                positions.push(pos);
            }
        }
    }

    positions.sort(function(a, b) {
        return a.getRangeTo(creep.pos) - b.getRangeTo(creep.pos) ||
            a.x - b.x ||
            a.y - b.y;
    });

    return positions[0] || null;
}

function ensureContainerSite(creep, source) {
    if(getSourceContainer(source) || getContainerSite(source)) {
        return true;
    }

    var pos = chooseContainerPos(creep, source);
    if(!pos) {
        return false;
    }

    var result = pos.createConstructionSite(STRUCTURE_CONTAINER);
    if(result == OK) {
        debug.log('debugConstruction', creep.name + ' planned remote container at ' + formatPos(pos), 1);
        return true;
    }

    debug.log('debugConstruction', creep.name + ' failed remote container site at ' + formatPos(pos) + ': ' + result, 10);
    return false;
}

function buildContainerSite(creep, source, site) {
    if(!site) {
        return false;
    }

    if(!creep.pos.inRangeTo(source, 1)) {
        creepUtils.moveTo(creep, source, '#ffaa00', 'build box', 'move:remoteBox');
        return true;
    }

    if(creep.store[RESOURCE_ENERGY] === 0) {
        var harvestResult = creep.harvest(source);
        if(harvestResult == OK) {
            creepUtils.announceIntent(creep, 'action:remoteHarvest', 'mine');
            return true;
        }

        if(harvestResult == ERR_NOT_ENOUGH_RESOURCES) {
            return waitForSourceRegen(creep, source);
        }

        if(harvestResult == ERR_NOT_OWNER) {
            return workAtHomeAfterBlocked(creep, 'not harvestable');
        }

        debug.log('debugRoles', creep.name + ' remote site harvest failed at ' + formatPos(source.pos) + ': ' + harvestResult, 3);
        return false;
    }

    var buildResult = creep.build(site);
    if(buildResult == OK) {
        creepUtils.announceIntent(creep, 'action:remoteBuild', 'build');
        return true;
    }

    if(buildResult == ERR_NOT_IN_RANGE) {
        creepUtils.moveTo(creep, source, '#ffaa00', 'build box', 'move:remoteBox');
        return true;
    }

    if(buildResult == ERR_INVALID_TARGET) {
        return false;
    }

    debug.log('debugRoles', creep.name + ' remote container build failed at ' + formatPos(site.pos) + ': ' + buildResult, 3);
    return false;
}

function mineToContainer(creep, source, container) {
    if(creep.store[RESOURCE_ENERGY] > 0 && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        var transferResult = creep.transfer(container, RESOURCE_ENERGY);
        if(transferResult == ERR_NOT_IN_RANGE) {
            creepUtils.moveTo(creep, container, '#ffaa00', 'fill box', 'move:remoteBox');
            return true;
        }

        if(transferResult == OK) {
            creepUtils.announceIntent(creep, 'action:remoteFill', 'fill');
            return true;
        }
    }

    if(!creep.pos.inRangeTo(source, 1)) {
        creepUtils.moveTo(creep, container, '#ffaa00', 'go mine', 'move:remoteMine');
        return true;
    }

    if(!creep.pos.isEqualTo(container.pos) && container.pos.lookFor(LOOK_CREEPS).length === 0) {
        creepUtils.moveTo(creep, container, '#ffaa00', 'mine box', 'move:remoteBox');
        return true;
    }

    if(creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0 && container.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        creep.drop(RESOURCE_ENERGY);
        creepUtils.announceIntent(creep, 'action:remoteDrop', 'drop');
        return true;
    }

    var harvestResult = creep.harvest(source);
    if(harvestResult == OK) {
        creepUtils.announceIntent(creep, 'action:remoteHarvest', 'mine');
        return true;
    }

    if(harvestResult == ERR_NOT_IN_RANGE) {
        creepUtils.moveTo(creep, source, '#ffaa00', 'go mine', 'move:remoteMine');
        return true;
    }

    if(harvestResult == ERR_NOT_ENOUGH_RESOURCES) {
        return waitForSourceRegen(creep, source);
    }

    if(harvestResult == ERR_NOT_OWNER) {
        return workAtHomeAfterBlocked(creep, 'not harvestable');
    }

    debug.log(
        'debugRoles',
        creep.name + ' remote container harvest failed at ' +
            formatPos(source.pos) +
            ' result=' + harvestResult +
            ' carry=' + creep.store[RESOURCE_ENERGY] + '/' +
            creep.store.getCapacity(RESOURCE_ENERGY) +
            ' workParts=' + creep.getActiveBodyparts(WORK),
        3
    );

    return false;
}

function waitForSourceRegen(creep, source) {
    var ticks = typeof source.ticksToRegeneration == 'number' ?
        source.ticksToRegeneration :
        '?';

    debug.log(
        'debugRoles',
        creep.name + ' waiting for remote source regen at ' +
            formatPos(source.pos) + ' ticks=' + ticks,
        10
    );
    creepUtils.announceIntent(creep, 'action:remoteWaitSource', 'wait');
    return true;
}

function mineLoose(creep, source) {
    if(creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }

    if(!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        creep.memory.working = true;
    }

    if(creep.memory.working) {
        return remoteManager.deliverHome(creep);
    }

    if(!creep.pos.inRangeTo(source, 1)) {
        creepUtils.moveTo(creep, source, '#ffaa00', 'go mine', 'move:remoteMine');
        return true;
    }

    var result = creep.harvest(source);
    if(result == OK) {
        creepUtils.announceIntent(creep, 'action:remoteHarvest', 'mine');
        return true;
    }

    if(result == ERR_NOT_ENOUGH_RESOURCES) {
        return waitForSourceRegen(creep, source);
    }

    if(result == ERR_NOT_OWNER) {
        return workAtHomeAfterBlocked(creep, 'not harvestable');
    }

    debug.log(
        'debugRoles',
        creep.name + ' remote harvest failed at ' +
            formatPos(source.pos) +
            ' result=' + result +
            ' carry=' + creep.store[RESOURCE_ENERGY] + '/' +
            creep.store.getCapacity(RESOURCE_ENERGY) +
            ' workParts=' + creep.getActiveBodyparts(WORK),
        3
    );

    return false;
}

var roleRemoteMiner = {
    run: function(creep) {
        if(remoteManager.hasThreats(creep.room)) {
            return retreatHome(creep, 'combat hostile');
        }

        if(creep.room.name == creep.memory.targetRoom &&
            remoteManager.hasHostileTower(creep.room)) {
            return retreatHome(creep, 'hostile tower');
        }

        if(deliverIfReturningHome(creep)) {
            return true;
        }

        if(!remoteManager.isRemoteUsable(creep.memory.homeRoom, creep.memory.targetRoom)) {
            return workAtHomeAfterBlocked(creep, 'remote blocked');
        }

        if(!remoteManager.isRemoteWorkable(creep.memory.homeRoom, creep.memory.targetRoom)) {
            return workAtHomeAfterBlocked(creep, 'remote not reserved');
        }

        if(creep.room.name != creep.memory.targetRoom) {
            return moveToTargetRoom(creep);
        }

        if(!remoteManager.canHarvestRemoteRoom(creep.room)) {
            return workAtHomeAfterBlocked(creep, 'not harvestable');
        }

        var source = chooseSource(creep);
        if(!source) {
            return retreatHome(creep, 'no sources');
        }

        if(canBuildRemoteInfrastructure(creep)) {
            ensureContainerSite(creep, source);
        }

        var containerSite = getContainerSite(source);
        if(!containerSite && canBuildRemoteInfrastructure(creep)) {
            containerSite = getAnyOrphanedContainerSite(creep.room);
        }
        if(containerSite && canBuildRemoteInfrastructure(creep)) {
            return buildContainerSite(creep, source, containerSite);
        }

        var container = getSourceContainer(source);
        if(container) {
            return mineToContainer(creep, source, container);
        }

        return mineLoose(creep, source);
    }
};

module.exports = roleRemoteMiner;
