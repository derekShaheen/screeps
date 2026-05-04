var debug = require('utils.debug');
var spawnManager = require('manager.spawn');

var STARTUP_KEY = createStartupKey();

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

var uiManager = {
    run: function(room) {
        if(!debug.enabled('debugVisuals')) {
            return;
        }

        var counts = spawnManager.countRoles(room);
        var targets = spawnManager.getTargets(room, counts);
        var hostiles = room.find(FIND_HOSTILE_CREEPS).length;
        var sites = room.find(FIND_CONSTRUCTION_SITES).length;
        var controller = room.controller;
        var rcl = controller ? controller.level : 0;
        var wallTarget = room.memory.wallTargetHits || 1000;

        var lines = [
            'Creepworks [' + STARTUP_KEY + ']',
            'Energy: ' + room.energyAvailable + ' / ' + room.energyCapacityAvailable,
            'RCL: ' + rcl + ' | ' + formatProgress(controller),
            'Creeps: H ' + counts.harvester + '/' + targets.harvester +
                ' | T ' + counts.transporter + '/' + targets.transporter +
                ' | B ' + counts.builder + '/' + targets.builder +
                ' | U ' + counts.upgrader + '/' + targets.upgrader +
                ' | M ' + counts.mineralHarvester + '/' + targets.mineralHarvester +
                ' | D ' + counts.defender + '/' + targets.defender,
            'Spawn: ' + getSpawnText(room),
            'Hostiles: ' + hostiles,
            'Towers: ' + getTowerText(room),
            'Walls: target ' + wallTarget,
            'Infra sites: ' + getInfrastructureSiteText(room),
            'Defense sites: ' + getDefenseSiteText(room),
            'Sites: ' + sites
        ];

        var x = 1;
        var y = 1;
        room.visual.rect(x - 0.4, y - 0.8, 18.4, lines.length + 0.3, {
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
