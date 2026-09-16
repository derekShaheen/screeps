var debug = require('utils.debug');
var spawnManager = require('manager.spawn');
var remoteManager = require('manager.remote');

function createStartupKey() {
    var tickPart = typeof Game != 'undefined' && Game.time !== undefined ?
        Game.time.toString(36) :
        'local';
    var randomPart = Math.floor(Math.random() * 1679616).toString(36);

    while(randomPart.length < 4) {
        randomPart = '0' + randomPart;
    }

    return tickPart + '-' + randomPart;
}

function getStartupKey() {
    if(!Memory.ui) {
        Memory.ui = {};
    }

    if(!Memory.ui.startupKey) {
        Memory.ui.startupKey = createStartupKey();
    }

    return Memory.ui.startupKey;
}

function formatProgress(controller) {
    if(!controller || !controller.progressTotal) {
        return '0%';
    }

    return Math.floor(controller.progress / controller.progressTotal * 100) + '%';
}

function getSpawnText(room) {
    var spawns = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });

    if(!spawns.length) {
        return 'none';
    }

    for(var i = 0; i < spawns.length; i++) {
        if(spawns[i].spawning) {
            return spawns[i].spawning.name;
        }
    }

    return 'idle';
}

function getTowerText(room) {
    var towers = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_TOWER;
        }
    });

    if(!towers.length) {
        return '0';
    }

    var energy = 0;
    var capacity = 0;
    for(var i = 0; i < towers.length; i++) {
        energy += towers[i].store[RESOURCE_ENERGY];
        capacity += towers[i].store.getCapacity(RESOURCE_ENERGY);
    }

    return towers.length + ' | ' + energy + '/' + capacity;
}

function getDefenseSiteText(room) {
    var counts = {
        wall: 0,
        rampart: 0
    };

    var sites = room.find(FIND_CONSTRUCTION_SITES, {
        filter: function(site) {
            return site.structureType == STRUCTURE_WALL ||
                site.structureType == STRUCTURE_RAMPART;
        }
    });

    for(var i = 0; i < sites.length; i++) {
        if(sites[i].structureType == STRUCTURE_WALL) {
            counts.wall++;
        }

        if(sites[i].structureType == STRUCTURE_RAMPART) {
            counts.rampart++;
        }
    }

    return 'W ' + counts.wall + ' | R ' + counts.rampart;
}

function getInfrastructureSiteText(room) {
    var counts = {
        extension: 0,
        road: 0,
        tower: 0,
        container: 0,
        storage: 0,
        link: 0,
        extractor: 0,
        terminal: 0,
        lab: 0
    };

    var sites = room.find(FIND_CONSTRUCTION_SITES, {
        filter: function(site) {
            return site.structureType == STRUCTURE_EXTENSION ||
                site.structureType == STRUCTURE_ROAD ||
                site.structureType == STRUCTURE_TOWER ||
                site.structureType == STRUCTURE_CONTAINER ||
                site.structureType == STRUCTURE_STORAGE ||
                site.structureType == STRUCTURE_LINK ||
                site.structureType == STRUCTURE_EXTRACTOR ||
                site.structureType == STRUCTURE_TERMINAL ||
                site.structureType == STRUCTURE_LAB;
        }
    });

    for(var i = 0; i < sites.length; i++) {
        if(siteIs(sites[i], STRUCTURE_EXTENSION)) {
            counts.extension++;
        }

        if(siteIs(sites[i], STRUCTURE_ROAD)) {
            counts.road++;
        }

        if(siteIs(sites[i], STRUCTURE_TOWER)) {
            counts.tower++;
        }

        if(siteIs(sites[i], STRUCTURE_CONTAINER)) {
            counts.container++;
        }

        if(siteIs(sites[i], STRUCTURE_STORAGE)) {
            counts.storage++;
        }

        if(siteIs(sites[i], STRUCTURE_LINK)) {
            counts.link++;
        }

        if(siteIs(sites[i], STRUCTURE_EXTRACTOR)) {
            counts.extractor++;
        }

        if(siteIs(sites[i], STRUCTURE_TERMINAL)) {
            counts.terminal++;
        }

        if(siteIs(sites[i], STRUCTURE_LAB)) {
            counts.lab++;
        }
    }

    return 'E ' + counts.extension +
        ' | R ' + counts.road +
        ' | T ' + counts.tower +
        ' | C ' + counts.container +
        ' | S ' + counts.storage +
        ' | L ' + counts.link +
        ' | Ex ' + counts.extractor +
        ' | Te ' + counts.terminal +
        ' | La ' + counts.lab;
}

function siteIs(site, structureType) {
    return site.structureType == structureType;
}

function getRemoteWorkerCounts(room) {
    var counts = {
        claimer: 0,
        reserver: 0,
        remoteMiner: 0,
        remoteHauler: 0
    };

    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(creep.memory.homeRoom != room.name || creep.spawning) {
            continue;
        }

        if(counts[creep.memory.role] !== undefined) {
            counts[creep.memory.role]++;
        }
    }

    return counts;
}

function getRemoteSlotSummary(room) {
    var settings = remoteManager.getSettings(room);
    var slots = 0;
    var assigned = 0;
    var discoveryRooms = 0;

    if(!settings.rooms) {
        return {
            assigned: assigned,
            slots: slots,
            discoveryRooms: discoveryRooms
        };
    }

    for(var remoteName in settings.rooms) {
        var remoteMemory = settings.rooms[remoteName];
        if(remoteMemory.status != 'ready' ||
            !remoteMemory.sourceIds ||
            remoteMemory.sourceIds.length === 0) {
            if(remoteMemory.enabled !== false &&
                (remoteMemory.status == 'unknown' ||
                !remoteMemory.sourceIds ||
                remoteMemory.sourceIds.length === 0)) {
                discoveryRooms++;
            }
            continue;
        }

        slots += remoteMemory.harvestSlots || remoteMemory.sourceIds.length;

        for(var i = 0; i < remoteMemory.sourceIds.length; i++) {
            var sourceId = remoteMemory.sourceIds[i];
            var sourceCapacity = remoteMemory.sourceHarvestSlots &&
                remoteMemory.sourceHarvestSlots[sourceId] ?
                remoteMemory.sourceHarvestSlots[sourceId] :
                1;

            var sourceAssigned = 0;
            for(var name in Game.creeps) {
                var creep = Game.creeps[name];
                if(creep.memory.homeRoom == room.name &&
                    creep.memory.role == 'remoteMiner' &&
                    creep.memory.targetRoom == remoteName &&
                    creep.memory.sourceId == sourceId &&
                    !creep.spawning) {
                    sourceAssigned++;
                }
            }

            assigned += Math.min(sourceAssigned, sourceCapacity);
        }
    }

    return {
        assigned: assigned,
        slots: slots,
        discoveryRooms: discoveryRooms
    };
}

function countRemoteMinersForRoom(homeRoomName, remoteRoomName) {
    var count = 0;
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(creep.memory.homeRoom == homeRoomName &&
            creep.memory.role == 'remoteMiner' &&
            creep.memory.targetRoom == remoteRoomName &&
            !creep.spawning) {
            count++;
        }
    }

    return count;
}

function formatEnergyAmount(amount) {
    if(amount >= 10000) {
        return Math.floor(amount / 1000) + 'k';
    }

    if(amount >= 1000) {
        return Math.floor(amount / 100) / 10 + 'k';
    }

    return String(amount);
}

function drawRemoteEnergyMapVisuals(room) {
    if(!Game.map ||
        !Game.map.visual ||
        typeof Game.map.visual.text != 'function') {
        return;
    }

    var settings = remoteManager.getSettings(room);
    if(!settings.rooms) {
        return;
    }

    for(var remoteName in settings.rooms) {
        var remoteMemory = settings.rooms[remoteName];
        if(remoteMemory.status != 'ready' ||
            !remoteMemory.sourceIds ||
            remoteMemory.sourceIds.length === 0) {
            continue;
        }

        var miners = countRemoteMinersForRoom(room.name, remoteName);
        if(miners <= 0) {
            continue;
        }

        var energy = remoteManager.getRemoteEnergyAmount(remoteName);
        if(energy <= 0 && !Game.rooms[remoteName]) {
            continue;
        }

        var color = energy >= 3000 ? '#ffcc33' :
            energy >= 1000 ? '#ffe680' :
            '#b6ff66';
        var label = 'haul ' + formatEnergyAmount(energy);

        Game.map.visual.text(label, new RoomPosition(25, 24, remoteName), {
            align: 'center',
            color: color,
            fontSize: 7,
            opacity: 0.9,
            stroke: '#111111',
            strokeWidth: 0.9
        });

        Game.map.visual.text('RM ' + miners, new RoomPosition(25, 31, remoteName), {
            align: 'center',
            color: '#ffffff',
            fontSize: 5,
            opacity: 0.75,
            stroke: '#111111',
            strokeWidth: 0.7
        });
    }
}

var uiManager = {
    run: function(room) {
        if(!debug.enabled('debugVisuals')) {
            return;
        }

        drawRemoteEnergyMapVisuals(room);

        var counts = spawnManager.countRoles(room);
        var remoteCounts = getRemoteWorkerCounts(room);
        var remoteSlots = getRemoteSlotSummary(room);
        var targets = spawnManager.getTargets(room, counts);
        var sites = room.find(FIND_CONSTRUCTION_SITES).length;
        var controller = room.controller;
        var rcl = controller ? controller.level : 0;
        var startupKey = getStartupKey();

        var lines = [
            'Creepworks [' + startupKey + ']',
            'Energy: ' + room.energyAvailable + ' / ' + room.energyCapacityAvailable,
            'RCL: ' + rcl + ' | ' + formatProgress(controller),
            'Creeps: H ' + counts.harvester + '/' + targets.harvester +
                ' | T ' + counts.transporter + '/' + targets.transporter +
                ' | B ' + counts.builder + '/' + targets.builder +
                ' | U ' + counts.upgrader + '/' + targets.upgrader +
                ' | M ' + counts.mineralHarvester + '/' + targets.mineralHarvester +
                ' | D ' + counts.defender + '/' + targets.defender,
            'Remote: Cl ' + remoteCounts.claimer +
                ' | Re ' + remoteCounts.reserver +
                ' | RM ' + remoteCounts.remoteMiner +
                ' (' + remoteSlots.assigned + '/' + remoteSlots.slots + ' slots)' +
                (remoteSlots.discoveryRooms ? ' | discover ' + remoteSlots.discoveryRooms : '') +
                ' | RH ' + remoteCounts.remoteHauler,
            'Spawn: ' + getSpawnText(room),
            'Towers: ' + getTowerText(room),
            'Infra sites: ' + getInfrastructureSiteText(room),
            'Sites: ' + sites
        ];

        var x = 1;
        var y = 1;
        room.visual.rect(x - 0.4, y - 0.8, 28.4, lines.length + 0.3, {
            fill: '#111111',
            opacity: 0.35,
            stroke: '#66ccff',
            strokeWidth: 0.05
        });

        for(var i = 0; i < lines.length; i++) {
            room.visual.text(lines[i], x, y + i, {
                align: 'left',
                color: '#ffffff',
                font: i === 0 ? 0.8 : 0.65,
                opacity: 0.9
            });
        }
    }
};

module.exports = uiManager;
