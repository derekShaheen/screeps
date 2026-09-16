var lifecycle = require('utils.lifecycle');
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
    if(creep.room.name != creep.memory.homeRoom) {
        remoteManager.markUnsafe(creep.memory.homeRoom, creep.room.name, reason || 'hostile threat');
    }
    creepUtils.announceIntent(creep, 'action:remoteRetreat', 'retreat');
    creepUtils.moveTo(creep, getHomeFallback(creep), '#ff66cc', 'home', 'move:remoteRetreat');
    return true;
}

function abortBlockedRemote(creep) {
    delete creep.memory.sourceId;
    clearHarvestSlot(creep);
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
    clearHarvestSlot(creep);
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
        clearHarvestSlot(creep);
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

function getRemoteMemory(creep) {
    var homeRoom = Game.rooms[creep.memory.homeRoom];
    if(!homeRoom) {
        return null;
    }

    var settings = remoteManager.getSettings(homeRoom);
    return settings.rooms ? settings.rooms[creep.memory.targetRoom] : null;
}

function countAssignedRemoteMiners(room, sourceId, selfName) {
    var count = 0;
    for(var name in Game.creeps) {
        var other = Game.creeps[name];
        if(other.name == selfName ||
            lifecycle.needsReplacement(other, other.memory.homeRoom, other.memory.targetRoom)) {
            continue;
        }

        if(other.memory.role == 'remoteMiner' &&
            other.memory.targetRoom == room.name &&
            other.memory.sourceId == sourceId) {
            count++;
        }
    }

    return count;
}

function clearHarvestSlot(creep) {
    delete creep.memory.remoteHarvestSlot;
}

function getSourceCapacity(creep, source) {
    return remoteManager.getRemoteSourceHarvestCapacity(getRemoteMemory(creep), source.id);
}

function getSourceAssignmentInfo(creep, source) {
    var capacity = getSourceCapacity(creep, source);
    var assigned = countAssignedRemoteMiners(creep.room, source.id, creep.name);
    return {
        source: source,
        capacity: capacity,
        assigned: assigned,
        hasOpenSlot: assigned < capacity,
        hasEnergy: source.energy > 0
    };
}

function getSourceAssignmentCandidates(creep) {
    var sources = creep.room.find(FIND_SOURCES);
    if(!sources.length) {
        return [];
    }

    var candidates = [];
    for(var i = 0; i < sources.length; i++) {
        var info = getSourceAssignmentInfo(creep, sources[i]);
        if(info.hasOpenSlot) {
            candidates.push(info);
        }
    }

    candidates.sort(function(a, b) {
        if(a.hasEnergy != b.hasEnergy) {
            return a.hasEnergy ? -1 : 1;
        }

        var pressureDiff = (a.assigned / a.capacity) - (b.assigned / b.capacity);
        if(pressureDiff !== 0) {
            return pressureDiff;
        }

        var assignmentDiff = a.assigned - b.assigned;
        if(assignmentDiff !== 0) {
            return assignmentDiff;
        }

        var regenA = typeof a.source.ticksToRegeneration == 'number' ? a.source.ticksToRegeneration : 9999;
        var regenB = typeof b.source.ticksToRegeneration == 'number' ? b.source.ticksToRegeneration : 9999;
        if(regenA != regenB) {
            return regenA - regenB;
        }

        return creep.pos.getRangeTo(a.source) - creep.pos.getRangeTo(b.source);
    });

    return candidates;
}

function getBestAvailableSource(creep, excludedSourceId, requireEnergy) {
    var candidates = getSourceAssignmentCandidates(creep);
    for(var i = 0; i < candidates.length; i++) {
        if(candidates[i].source.id != excludedSourceId && candidates[i].hasEnergy) {
            return candidates[i].source;
        }
    }

    if(requireEnergy) {
        return null;
    }

    for(var j = 0; j < candidates.length; j++) {
        if(candidates[j].source.id != excludedSourceId) {
            return candidates[j].source;
        }
    }

    return null;
}

function assignSource(creep, source) {
    creep.memory.sourceId = source.id;
    clearHarvestSlot(creep);
    return source;
}

function chooseSource(creep) {
    if(creep.memory.sourceId) {
        var remembered = Game.getObjectById(creep.memory.sourceId);
        if(remembered) {
            var assigned = countAssignedRemoteMiners(creep.room, remembered.id, creep.name);
            var hasRememberedSlot = creep.memory.remoteHarvestSlot &&
                creep.memory.remoteHarvestSlot.sourceId == remembered.id;

            if(remembered.energy === 0 &&
                creep.store[RESOURCE_ENERGY] === 0) {
                var replacement = getBestAvailableSource(creep, remembered.id, true);
                if(replacement) {
                    debug.log(
                        'debugRoles',
                        creep.name + ' reassigning from depleted remote source ' +
                            formatPos(remembered.pos) + ' to ' + formatPos(replacement.pos),
                        5
                    );
                    return assignSource(creep, replacement);
                }
            }

            if(assigned < getSourceCapacity(creep, remembered) || hasRememberedSlot) {
                return remembered;
            }
        }

        if(creep.room.name != creep.memory.targetRoom) {
            return null;
        }

        delete creep.memory.sourceId;
        clearHarvestSlot(creep);
    }

    var source = getBestAvailableSource(creep, null, false);
    if(!source) {
        return null;
    }

    return assignSource(creep, source);
}

function reassignFromDepletedSource(creep, source) {
    if(creep.store[RESOURCE_ENERGY] > 0) {
        return false;
    }

    var replacement = getBestAvailableSource(creep, source.id, true);
    if(!replacement) {
        return false;
    }

    debug.log(
        'debugRoles',
        creep.name + ' moving from empty remote source ' +
            formatPos(source.pos) + ' to ' + formatPos(replacement.pos),
        5
    );
    assignSource(creep, replacement);
    return true;
}

function handleSaturatedRemote(creep) {
    if(!remoteManager.areRemoteExtractionSlotsFilled(creep.memory.homeRoom, creep.memory.targetRoom)) {
        return false;
    }

    creepUtils.announceIntent(creep, 'action:remoteIdle', 'idle');
    return remoteManager.moveHome(creep, 'remoteIdle');
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

function isWalkableHarvestPosition(room, pos) {
    if(pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49) {
        return false;
    }

    if(room.getTerrain().get(pos.x, pos.y) == TERRAIN_MASK_WALL) {
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

function getHarvestPositions(source) {
    var positions = [];
    for(var dx = -1; dx <= 1; dx++) {
        for(var dy = -1; dy <= 1; dy++) {
            if(dx === 0 && dy === 0) {
                continue;
            }

            var pos = new RoomPosition(source.pos.x + dx, source.pos.y + dy, source.pos.roomName);
            if(isWalkableHarvestPosition(source.room, pos)) {
                positions.push(pos);
            }
        }
    }

    return positions;
}

function isOccupiedByOther(creep, pos) {
    var creeps = pos.lookFor(LOOK_CREEPS);
    for(var i = 0; i < creeps.length; i++) {
        if(creeps[i].name != creep.name) {
            return true;
        }
    }

    return false;
}

function isHarvestSlotClaimedByOther(creep, source, pos) {
    for(var name in Game.creeps) {
        var other = Game.creeps[name];
        if(other.name == creep.name ||
            other.memory.role != 'remoteMiner' ||
            other.memory.targetRoom != creep.memory.targetRoom ||
            other.memory.sourceId != source.id ||
            !other.memory.remoteHarvestSlot) {
            continue;
        }

        var slot = other.memory.remoteHarvestSlot;
        if(slot.sourceId == source.id &&
            slot.x == pos.x &&
            slot.y == pos.y &&
            slot.roomName == pos.roomName) {
            return true;
        }
    }

    return false;
}

function rememberHarvestSlot(creep, source, pos) {
    creep.memory.remoteHarvestSlot = {
        sourceId: source.id,
        x: pos.x,
        y: pos.y,
        roomName: pos.roomName
    };
}

function getRememberedHarvestSlot(creep, source) {
    var slot = creep.memory.remoteHarvestSlot;
    if(!slot || slot.sourceId != source.id || slot.roomName != source.pos.roomName) {
        return null;
    }

    var pos = new RoomPosition(slot.x, slot.y, slot.roomName);
    if(!isWalkableHarvestPosition(source.room, pos) ||
        isOccupiedByOther(creep, pos) ||
        isHarvestSlotClaimedByOther(creep, source, pos)) {
        clearHarvestSlot(creep);
        return null;
    }

    return pos;
}

function chooseHarvestPosition(creep, source, preferredPos) {
    var remembered = getRememberedHarvestSlot(creep, source);
    if(remembered) {
        return remembered;
    }

    var positions = getHarvestPositions(source);
    var candidates = [];

    for(var i = 0; i < positions.length; i++) {
        if(isOccupiedByOther(creep, positions[i]) ||
            isHarvestSlotClaimedByOther(creep, source, positions[i])) {
            continue;
        }

        candidates.push(positions[i]);
    }

    if(!candidates.length) {
        if(creep.pos.inRangeTo(source, 1) &&
            isWalkableHarvestPosition(source.room, creep.pos) &&
            !isHarvestSlotClaimedByOther(creep, source, creep.pos)) {
            rememberHarvestSlot(creep, source, creep.pos);
            return creep.pos;
        }

        return null;
    }

    candidates.sort(function(a, b) {
        var aPreferred = preferredPos && a.isEqualTo(preferredPos) ? -100 : 0;
        var bPreferred = preferredPos && b.isEqualTo(preferredPos) ? -100 : 0;
        var aCurrent = a.isEqualTo(creep.pos) ? -50 : 0;
        var bCurrent = b.isEqualTo(creep.pos) ? -50 : 0;
        var scoreDiff = (aPreferred + aCurrent + creep.pos.getRangeTo(a)) -
            (bPreferred + bCurrent + creep.pos.getRangeTo(b));
        if(scoreDiff !== 0) {
            return scoreDiff;
        }

        return a.x - b.x || a.y - b.y;
    });

    rememberHarvestSlot(creep, source, candidates[0]);
    return candidates[0];
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

    var harvestPos = chooseHarvestPosition(creep, source, site.pos);
    if(!harvestPos) {
        creepUtils.announceIntent(creep, 'action:remoteWaitSlot', 'wait');
        return true;
    }

    if(!creep.pos.isEqualTo(harvestPos)) {
        creepUtils.moveTo(creep, harvestPos, '#ffaa00', 'build box', 'move:remoteBox');
        return true;
    }

    if(creep.store[RESOURCE_ENERGY] === 0) {
        var harvestResult = creep.harvest(source);
        if(harvestResult == OK) {
            creepUtils.announceIntent(creep, 'action:remoteHarvest', 'mine');
            return true;
        }

        if(harvestResult == ERR_NOT_ENOUGH_RESOURCES) {
            if(reassignFromDepletedSource(creep, source)) {
                return true;
            }

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
        creepUtils.moveTo(creep, harvestPos, '#ffaa00', 'build box', 'move:remoteBox');
        return true;
    }

    if(buildResult == ERR_INVALID_TARGET) {
        return false;
    }

    debug.log('debugRoles', creep.name + ' remote container build failed at ' + formatPos(site.pos) + ': ' + buildResult, 3);
    return false;
}

function mineToContainer(creep, source, container) {
    var harvestPos = chooseHarvestPosition(creep, source, container.pos);

    if(creep.store[RESOURCE_ENERGY] > 0 &&
        creep.pos.inRangeTo(container, 1) &&
        container.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
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

    if(!harvestPos) {
        creepUtils.announceIntent(creep, 'action:remoteWaitSlot', 'wait');
        return true;
    }

    if(!creep.pos.isEqualTo(harvestPos)) {
        creepUtils.moveTo(creep, harvestPos, '#ffaa00', 'go mine', 'move:remoteMine');
        return true;
    }

    if(creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
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
        if(reassignFromDepletedSource(creep, source)) {
            return true;
        }

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

    var harvestPos = chooseHarvestPosition(creep, source, null);
    if(!harvestPos) {
        creepUtils.announceIntent(creep, 'action:remoteWaitSlot', 'wait');
        return true;
    }

    if(!creep.pos.isEqualTo(harvestPos)) {
        creepUtils.moveTo(creep, harvestPos, '#ffaa00', 'go mine', 'move:remoteMine');
        return true;
    }

    var result = creep.harvest(source);
    if(result == OK) {
        creepUtils.announceIntent(creep, 'action:remoteHarvest', 'mine');
        return true;
    }

    if(result == ERR_NOT_ENOUGH_RESOURCES) {
        if(reassignFromDepletedSource(creep, source)) {
            return true;
        }

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
            return workAtHomeAfterBlocked(creep, 'remote not workable');
        }

        if(creep.room.name != creep.memory.targetRoom) {
            return moveToTargetRoom(creep);
        }

        if(!remoteManager.canHarvestRemoteRoom(creep.room)) {
            return workAtHomeAfterBlocked(creep, 'not harvestable');
        }

        if(!creep.memory.sourceId && handleSaturatedRemote(creep)) {
            return true;
        }

        var source = chooseSource(creep);
        if(!source) {
            if(handleSaturatedRemote(creep)) {
                return true;
            }

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
