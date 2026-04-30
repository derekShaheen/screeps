var SPAWN_AREA_STRUCTURES = {};
SPAWN_AREA_STRUCTURES[STRUCTURE_SPAWN] = true;
SPAWN_AREA_STRUCTURES[STRUCTURE_EXTENSION] = true;
SPAWN_AREA_STRUCTURES[STRUCTURE_TOWER] = true;
SPAWN_AREA_STRUCTURES[STRUCTURE_STORAGE] = true;
SPAWN_AREA_STRUCTURES[STRUCTURE_TERMINAL] = true;
SPAWN_AREA_STRUCTURES[STRUCTURE_LINK] = true;
SPAWN_AREA_STRUCTURES[STRUCTURE_LAB] = true;

function getPosKey(pos) {
    return pos.x + ':' + pos.y;
}

function getPrimarySpawn(room) {
    var spawns = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });

    return spawns[0] || null;
}

function getSpawnAreaRampartRange(room) {
    var settings = room.memory && room.memory.construction ? room.memory.construction : {};
    var range = settings.spawnAreaRampartRange;
    if(typeof range != 'number') {
        range = 7;
    }

    return Math.max(3, Math.min(15, range));
}

function getSpawnAreaRampartPadding(room) {
    var settings = room.memory && room.memory.construction ? room.memory.construction : {};
    var padding = settings.spawnAreaRampartPadding;
    if(typeof padding != 'number') {
        padding = 1;
    }

    return Math.max(1, Math.min(3, padding));
}

function shouldIncludeSpawnAreaStructure(spawn, pos, structureType, range) {
    return !!SPAWN_AREA_STRUCTURES[structureType] &&
        pos.roomName == spawn.pos.roomName &&
        pos.getRangeTo(spawn) <= range;
}

function addFootprintPosition(room, footprint, pos) {
    var key = getPosKey(pos);
    if(footprint.map[key]) {
        return;
    }

    footprint.map[key] = true;
    footprint.positions.push(new RoomPosition(pos.x, pos.y, room.name));
}

function collectSpawnAreaFootprint(room, spawn, range) {
    var footprint = {
        positions: [],
        map: {}
    };

    addFootprintPosition(room, footprint, spawn.pos);

    var structures = room.find(FIND_STRUCTURES);
    for(var i = 0; i < structures.length; i++) {
        if(shouldIncludeSpawnAreaStructure(spawn, structures[i].pos, structures[i].structureType, range)) {
            addFootprintPosition(room, footprint, structures[i].pos);
        }
    }

    var sites = room.find(FIND_CONSTRUCTION_SITES);
    for(var j = 0; j < sites.length; j++) {
        if(sites[j].my === false) {
            continue;
        }

        if(shouldIncludeSpawnAreaStructure(spawn, sites[j].pos, sites[j].structureType, range)) {
            addFootprintPosition(room, footprint, sites[j].pos);
        }
    }

    return footprint;
}

function getBounds(room, positions, padding) {
    if(!positions.length) {
        return null;
    }

    var minX = positions[0].x;
    var maxX = positions[0].x;
    var minY = positions[0].y;
    var maxY = positions[0].y;

    for(var i = 1; i < positions.length; i++) {
        minX = Math.min(minX, positions[i].x);
        maxX = Math.max(maxX, positions[i].x);
        minY = Math.min(minY, positions[i].y);
        maxY = Math.max(maxY, positions[i].y);
    }

    return {
        minX: Math.max(2, minX - padding),
        maxX: Math.min(47, maxX + padding),
        minY: Math.max(2, minY - padding),
        maxY: Math.min(47, maxY + padding)
    };
}

function isNaturallyBlocked(room, x, y) {
    return room.getTerrain().get(x, y) == TERRAIN_MASK_WALL;
}

function getSpawnAreaRampartPlan(room) {
    if(room._spawnAreaRampartPlan &&
        typeof Game !== 'undefined' &&
        room._spawnAreaRampartPlan.time == Game.time) {
        return room._spawnAreaRampartPlan.plan;
    }

    var spawn = getPrimarySpawn(room);
    if(!spawn) {
        return null;
    }

    var range = getSpawnAreaRampartRange(room);
    var padding = getSpawnAreaRampartPadding(room);
    var footprint = collectSpawnAreaFootprint(room, spawn, range);
    var bounds = getBounds(room, footprint.positions, padding);
    if(!bounds) {
        return null;
    }

    var positions = [];
    var map = {};
    for(var x = bounds.minX; x <= bounds.maxX; x++) {
        for(var y = bounds.minY; y <= bounds.maxY; y++) {
            if(x != bounds.minX && x != bounds.maxX && y != bounds.minY && y != bounds.maxY) {
                continue;
            }

            if(isNaturallyBlocked(room, x, y)) {
                continue;
            }

            var pos = new RoomPosition(x, y, room.name);
            map[getPosKey(pos)] = true;
            positions.push(pos);
        }
    }

    var plan = {
        spawn: spawn,
        range: range,
        bounds: bounds,
        footprint: footprint,
        positions: positions,
        map: map
    };

    if(typeof Game !== 'undefined') {
        room._spawnAreaRampartPlan = {
            time: Game.time,
            plan: plan
        };
    }

    return plan;
}

function isInsideBounds(pos, bounds) {
    return bounds &&
        pos.x > bounds.minX &&
        pos.x < bounds.maxX &&
        pos.y > bounds.minY &&
        pos.y < bounds.maxY;
}

function isObsoleteInnerRampartPosition(room, pos) {
    var plan = getSpawnAreaRampartPlan(room);
    if(!plan) {
        return false;
    }

    if(plan.map[getPosKey(pos)]) {
        return false;
    }

    return isInsideBounds(pos, plan.bounds);
}

function shouldMaintainDefenseStructure(structure) {
    if(structure.structureType != STRUCTURE_RAMPART) {
        return true;
    }

    return !isObsoleteInnerRampartPosition(structure.room, structure.pos);
}

function shouldBuildConstructionSite(site) {
    if(site.structureType != STRUCTURE_RAMPART) {
        return true;
    }

    return !isObsoleteInnerRampartPosition(site.room, site.pos);
}

module.exports = {
    getSpawnAreaRampartPlan: getSpawnAreaRampartPlan,
    isObsoleteInnerRampartPosition: isObsoleteInnerRampartPosition,
    shouldBuildConstructionSite: shouldBuildConstructionSite,
    shouldMaintainDefenseStructure: shouldMaintainDefenseStructure
};
