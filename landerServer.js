const startServer = require('./serverSocketInterface').startServer;

const amountDiv = 300;

const grav = 0.1;
const thrust = 0.4;
const turnMult = 0.2;

const numGroundPoints = 12;
const groundYPosLowerBound = 0;
const groundYPosUpperBound = 200;

const enableGrav = true;

const nodeSize = 15;
const bounceSpeedMultiplier = 0.2;
const numTicksBetweenCollide = 5;

const tipMult = 0.1;
const centerOfMass = 'top';
const predictMult = 5;

const angleBounceMult = 0.025;
const rotateTolerance = nodeSize/2;

const landingSpeedCap = 0.3;

const roundIfUnder = 0.00001;


class Game {
    constructor(socket) {
        this.socket = socket;
        this.lastTime = Date.now();
        this.lander = new Lander(initLander);
        this.ground = null;
        this.freeze = true;
        this.screen = null;
        this.canUnfreeze = true;
    }

    moveLander(amount,keys) {
        if (keys.includes('q')) {
            this.lander.root.avel += amount * turnMult;
        }
        if (keys.includes('e')) {
            this.lander.root.avel -= amount * turnMult;
        }
        if (keys.includes('w')) {
            this.lander.fireEngine(amount*thrust);
        }
        if (keys.includes('r')) {this.reset()}
    }

    update(packet) {
        packet = JSON.parse(packet);
        const deltaTime = parseInt(packet.time) - this.lastTime;
        if (deltaTime == 0) {return}
        this.lastTime = parseInt(packet.time);
        if (!this.freeze) {
            this.moveLander(deltaTime/amountDiv, packet.keys);
            this.lander.updateLander(deltaTime/amountDiv,this.ground,this.screen);
            this.checkCollision();
            this.checkWin();
            this.lander.round();
        }
        
    }

    checkWin() {
        //note: isOnGround may be a little buggy
        const lleg = this.lander.nodes.filter(x => x.type == 'lleg')[0];
        const rleg = this.lander.nodes.filter(x => x.type == 'rleg')[0];
        if ((Math.abs(lleg.xvel) + Math.abs(lleg.yvel) == 0) &&
            (Math.abs(rleg.xvel) + Math.abs(rleg.yvel) == 0) &&
            (lleg.isOnGround && rleg.isOnGround)) {
            this.win();
        }
    }

    checkLose(node) {
        if (node.type != 'lleg' && node.type != 'rleg') {this.lose(); return}
        if ((Math.abs(node.xvel) + Math.abs(node.yvel)) > landingSpeedCap) {this.lose(); return}
    }

    lose() {
        console.log('You Lose!');
        this.reset();
    }

    win() {
        console.log('You Win!');
        this.reset();
    }

    handleMessage(message) {
        const requestCode = message.slice(0,4);
        const payload = message.slice(5);
        switch(requestCode) {
            case 'RNFA': this.socket.sendData(JSON.stringify(this.lander.nodes),'LDRP'); this.update(payload); break;
            case 'INIT': this.initialize(payload); break;
        }
    }

    initialize(screen) {
        if (this.canUnfreeze) {this.freeze = false; this.canUnfreeze = false} else {this.checkCanUnfreeze()}
        screen = JSON.parse(screen);
        screen.width = parseInt(screen.width);
        screen.height = parseInt(screen.height);
        this.screen = screen;
        const ground = this.createGround(screen);
        this.ground = ground;
        this.socket.sendData(JSON.stringify(ground),'GRND');
    }

    checkCanUnfreeze() {
        if (this.canUnfreeze) {this.freeze = false; this.canUnfreeze = false} else {setTimeout(() => this.checkCanUnfreeze(),200)}
    }

    createGround(screen) {
        const defaultY = screen.height + 100 - (groundYPosUpperBound - groundYPosLowerBound);
        const groundPoints = [{x:0, y:defaultY}];
        const defaultSpacing = screen.width/numGroundPoints
        let prevY = defaultY;
        for (let ind = 1; ind < numGroundPoints-1; ind++) {
            if (ind % 2 == 0) {
                const x = (defaultSpacing*ind) + (1 - Math.random()) * (defaultSpacing / 2);
                const y = screen.height - (groundYPosLowerBound + random(groundYPosUpperBound));
                prevY = y;
                groundPoints.push({x:x, y:y});
            } else {
                const x = (defaultSpacing*ind) + (1 - Math.random()) * (defaultSpacing / 2);
                groundPoints.push({x:x,y:prevY});
            }
        }
        groundPoints.push({x:screen.width, y:prevY});

        return setToInt(groundPoints);
    }

    checkCollision() {
        for (let node of this.lander.nodes) {
            if (checkIfOutsideMap(node,this.screen)) {this.reset(); return}
            const collisionData = checkNodeCollided(node,this.ground,nodeSize/2);
            if (collisionData.collided) {
                this.checkLose(node);
                if (collisionData.node.ticksToNextPossCollision != 0) {collisionData.node.ticksToNextPossCollision--; return}
                collisionData.node.ticksToNextPossCollision = numTicksBetweenCollide;
                bounce(collisionData.p1, collisionData.p2, collisionData.node, this.lander);
                node.isOnGround = true;
            } else {
                node.isOnGround = false;
                if (node.ticksToNextPossCollision != 0) {node.ticksToNextPossCollision--}
            }
        }
    }

    reset() {
        this.freeze = true;
        this.canUnfreezeTimer = setTimeout(() => this.canUnfreeze = true, 500);
        this.lander = new Lander(initLander);
        this.socket.sendData('', 'RSET');
    }

    

    handleClose() {}

}

class Lander {
    constructor(initLander) {
        this.nodes = initLander.map(i => new LanderNode(i.x, i.y, i.type));
        this.root = this.nodes.filter(x => x.type == 'root')[0];

    }
    rotate(point,deg,ground,screen) {
        function rotateRoot(lander,point,deg,ground,screen) {
            const lleg = lander.nodes.filter(x => x.type == 'lleg')[0];
            const rleg = lander.nodes.filter(x => x.type == 'rleg')[0];
            const rotateFromRoot = checkCanRotate(lander,point,deg,ground,true,screen);
            if (rotateFromRoot.canRotate) {applyNodes(lander,rotateFromRoot.newNodes)} else {
                if ((lleg.isOnGround && !rleg.isOnGround) || (lleg.isOnGround && rleg.isOnGround && point.avel > 0)) {
                    lleg.avel += point.avel;
                    point.avel = 0;
                } else if ((!lleg.isOnGround && rleg.isOnGround) || (lleg.isOnGround && rleg.isOnGround && point.avel < 0)) {
                    rleg.avel += point.avel;
                    point.avel = 0;
                } else {point.avel = 0}
            }
        }

        function applyNodes(lander,nodes) {
            nodes.forEach((node) => {
                const matchingNode = lander.nodes.filter(i => i.type == node.type)[0];
                matchingNode.x = node.node.x;
                matchingNode.y = node.node.y;
            });
        }

        if (point.type == 'root') {rotateRoot(this,point,deg,ground,screen)} else {
            const newNodes = checkCanRotate(this,point,deg,ground,false,screen);
            if (newNodes.canRotate) {
                applyNodes(this,newNodes.newNodes);
            } else {point.avel = -(point.avel * angleBounceMult)}
        }
    }

    findThrust() {
        const top = this.nodes.filter(x => x.type == 'top')[0];
        const angleRad = Math.atan2(this.root.y-top.y, top.x-this.root.x);
        const angle = angleRad * (180/Math.PI);
        let thrustX;
        if (Math.abs(angle) >= 90) {
            thrustX = (Math.abs(angle) - 90) / 90;
        } else {
            thrustX = 1 - (Math.abs(angle) / 90);
        }

        const thrustY = 1 - thrustX;
        const quadrant = findQuadrant(angleRad);
        switch (quadrant) {
            case 0: return {x: thrustX, y: -thrustY}
            case 1: return {x: -thrustX, y: -thrustY}
            case 2: return {x: -thrustX, y: thrustY}
            case 3: return {x: thrustX, y: thrustY}
        }
    }

    tip(amount) {
        const cOM = this.nodes.filter(x => x.type == centerOfMass)[0];
        const lleg = this.nodes.filter(x => x.type == 'lleg')[0];
        const rleg = this.nodes.filter(x => x.type == 'rleg')[0];
        if (lleg.isOnGround && !rleg.isOnGround) { 
            if (cOM.x > lleg.x) {
                lleg.avel -= (Math.abs(lleg.x - cOM.x) / dist) * amount * tipMult;
            } else {
                lleg.avel += (Math.abs(lleg.x - cOM.x) / dist) * amount * tipMult;
            }
        }
        if (!lleg.isOnGround && rleg.isOnGround) {
            if (cOM.x < rleg.x) {
                rleg.avel += (Math.abs(cOM.x - rleg.x) / dist) * amount * tipMult;
            } else {
                rleg.avel -= (Math.abs(cOM.x - rleg.x) / dist) * amount * tipMult;
            }
        }
    }

    fireEngine(thrustMult) {
        const mults = this.findThrust();
        for (let node of this.nodes) {
            node.xvel += mults.x * thrustMult;
            node.yvel += mults.y * thrustMult;
        }
    }

    round() {
        for (let node of this.nodes) {node.round()}
    }

    updateLander(amount,ground,screen) {
        const isOnGround = this.nodes.filter(i => i.isOnGround == true).length > 0;
        for (let node of this.nodes) {
            if (enableGrav && !isOnGround) {node.yvel += grav*amount} else if (isOnGround) {
                this.tip(amount);
            }
            if (node.avel != 0) {
                this.rotate(node,node.avel,ground,screen);
            }
            node.x += node.xvel;
            node.y += node.yvel;
        }

    }
}

class LanderNode {
    constructor(x,y,type) {
    this.x = x;
    this.y = y;
    this.xvel = 0;
    this.yvel = 0;
    this.avel = 0;
    this.type = type;
    this.isOnGround = false;
    this.ticksToNextPossCollision = 0;
    }

    round() {
        this.xvel = Math.abs(this.xvel) < roundIfUnder? 0 : this.xvel;
        this.yvel = Math.abs(this.yvel) < roundIfUnder? 0 : this.yvel;
        this.avel = Math.abs(this.avel) < roundIfUnder? 0 : this.avel;
    }
}

const checkInterval = function(p1,p2,node,tolerance) {
    const m = (p2.y-p1.y) / (p2.x-p1.x);
    const b = p1.y - m*p1.x;
    const intersectY = m * node.x + b;
    return {collided:node.y >= intersectY - tolerance, intersectX:node.x, intersectY:intersectY, p1:p1, p2:p2, node:node}
}

const checkNodeCollided = function(node,ground,tolerance) {
    let collisionData;
    for (let ind = 0; ind < ground.length-1; ind++) {
        if (ground[ind].x <= node.x && ground[ind+1].x > node.x) {collisionData = checkInterval(ground[ind], ground[ind+1], node, tolerance)}
    }
    return collisionData;
}

const checkCanRotate = function(lander,point,deg,ground,shouldPredict,screen) {
    const newNodes = [];
    for (let node of lander.nodes) {if (node != point) {
        let newNode = updAngle(point,node,deg);
        if (checkIfOutsideMap(newNode,screen)) {return {canRotate:false,newNodes:null}}
        let collided;
        if (shouldPredict) {
            const noPredict = checkNodeCollided(newNode,ground,rotateTolerance).collided;
            if (checkIfOutsideMap(updAngle(point,node,deg*predictMult),screen)) {return {canRotate:false,newNodes:null}}
            const didPredict = checkNodeCollided(updAngle(point,node,deg*predictMult),ground,rotateTolerance).collided;
            collided = noPredict || didPredict;
        } else {
            collided = checkNodeCollided(newNode,ground,rotateTolerance).collided;
        }
        if (collided) {node.isOnGround = true; return {canRotate:false, newNodes:null}} else {node.isOnGround = false}
        newNodes.push({node:newNode, type:node.type});
    }}
    return {canRotate:true,newNodes:newNodes}
} 

const checkIfOutsideMap = function(point,screen) {
    if (point.x >= 0 && point.x < screen.width && point.y >= 0 && point.y < screen.height) {return false}
    return true;
}

const updAngle = function(p1,p2,deltaA) {
    const distX = (p2.x-p1.x);
    const distY = (p1.y-p2.y);
    const dist = Math.sqrt(Math.pow(distX,2) + Math.pow(distY,2));
    let theta = Math.atan2(distY,distX) + rad(deltaA);
    theta = theta > Math.PI? theta - Math.PI * 2 : theta;
    const deltaX = Math.abs(Math.cos(theta)) * dist;
    const deltaY = Math.abs(Math.sin(theta)) * dist;
    const quadrant = findQuadrant(theta);
    switch (quadrant) {
        case 0: return {x: p1.x+deltaX, y: p1.y-deltaY}
        case 1: return {x: p1.x-deltaX, y: p1.y-deltaY}
        case 2: return {x: p1.x-deltaX, y: p1.y+deltaY}
        case 3: return {x: p1.x+deltaX, y: p1.y+deltaY}
    }
}

const findQuadrant = function(theta) {
    if (theta == 0) {return 0}
    const isSecondQuadrant = Math.floor(Math.abs(theta / (Math.PI / 2)));
    return Math.sign(theta) == 1? isSecondQuadrant : -1 * isSecondQuadrant + 3;
}

const rad = function(n) {return n*(Math.PI/180)}

const random = function(n) {
    return Math.floor(Math.random()*n);
}

const setToInt = function(lst) {
    return lst.map(pt => {return {x: Math.floor(pt.x), y: Math.floor(pt.y)}});
}

const findBounceAng = function(g1,g2,landerPt) {
    let groundAngle = toDeg(Math.atan2(g1.y-g2.y,g2.x-g1.x));
    if (landerPt.xvel < 0) {groundAngle = (groundAngle + 180) % 360}
    let landerAngle = toDeg(Math.atan2(-landerPt.yvel, landerPt.xvel));
    landerAngle = (landerAngle + 180) % 360;
    const resAngle = (((groundAngle + 180) % 360) + (groundAngle - landerAngle)) % 360;
    return resAngle >= 0? resAngle : (resAngle + 360) % 360
}

const toDeg = function(angle) {
    if (angle < 0) {
        angle = 2*Math.PI + angle;
    }
    return angle * (180/Math.PI);
}

const bounce = function(g1,g2,landerPt,lander) {
    const bounceAng = findBounceAng(g1,g2,landerPt);
    const totVel = (Math.abs(landerPt.xvel) + Math.abs(landerPt.yvel)) * bounceSpeedMultiplier;
    const slope = bounceAng % 90 == 0? 999999999999999 : Math.tan(bounceAng * (Math.PI/180));
    const newYVel = Math.abs((slope / (Math.abs(slope)+1)) * totVel);
    const newXVel = Math.abs(totVel - Math.abs(newYVel));
    for (let pt of lander.nodes) {
        switch(Math.floor(bounceAng / 90)) {
            case 0: pt.xvel = newXVel; pt.yvel = -newYVel; break;
            case 1: pt.xvel = -newXVel; pt.yvel = -newYVel; break;
            case 2: pt.xvel = -newXVel; pt.yvel = newYVel; break;
            case 3: pt.xvel = newXVel; pt.yvel = newYVel; break;
        }
        
    }
}

const initLander = [
    new LanderNode(200,200,'root'),
    new LanderNode(200,170,'top'),
    new LanderNode(178.8,221.2,'lleg'),
    new LanderNode(221.2,221.2,'rleg'),
];

const dist = initLander.filter(x => x.type == 'lleg')[0].y - initLander.filter(x => x.type == centerOfMass)[0].y;

startServer((socket) => new Game(socket));