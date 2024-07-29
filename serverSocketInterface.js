const WebSocketServer = require('ws');
const crypto = require('crypto');

let connID = 0;

const MAX_FAILED_PINGS = 2;
const TIME_BETWEEN_PINGS = 2500;
const LATE_PING_GRACE_PD = 500;

const REQ_CODE_LENGTH = 4;

const MAX_MESSAGE_SEND_ATTEMPTS = 3;
const TIME_BETWEEN_MESSAGE_SEND_ATTEMPTS = 500;

const port = 8080;

const connLst = [];

let handlerFunction;

function startServer(createHandler=() => {foo:'bar'}) {
  const wss = new WebSocketServer.Server({ port: port });

  wss.clientTracking = true;

  handlerFunction = createHandler;
  
  wss.on("connection", socket => {
    const newSocket = new SocketConnection(socket,connID);
    const handler = handlerFunction(newSocket);
    newSocket.handler = handler;
    connID++;
  });

  console.log(`Server is listening on port ${port}!`)
}

function testStartServer() {
  const wss = new WebSocketServer.Server({ port: 8080 });

  wss.clientTracking = true;
  
  wss.on("connection", socket => {
    const newSocket = new SocketConnection(socket,connID);
    connLst.push(newSocket);
    connID++;
  });

  console.log('Server is listening on port 8080!')
}

function handleFailedPing(socket) {
  if (!socket.enabled) {return}
  socket.failedPings++;
  console.log(`Client ${socket.id} has failed to ping`)
  if (socket.failedPings >= MAX_FAILED_PINGS) {
    socket.client.close(1000, "CONN_TIMEOUT");
    console.log(`Client ${socket.id} has timed out`);
  } else {
    socket.catchTimeout();
  }
}

class SocketConnection {
  constructor(client,id) {
    this.id = id;
    this.messageId = 0;
    this.enabled = true;
    this.listOfMessages = [];
    this.sessionId = crypto.randomUUID();;
    this.handler = undefined;
    connLst.push({sessionId:this.sessionId,session:this})
    this.onNewSocket(client);
  }

  onNewSocket(client) {
    this.client = client;
    this.failedPings = 0;
    this.catchTimeout();
    this.client.on('message',(message) => this.handleMessage(message));
    this.client.on('close', () => this.handleClose());
    this.client.on('error', (error) => this.handleError(error));
  }

  catchTimeout() {
    if (!this.enabled) {return}
    // Sets up a Timeout to limit the time between pings from the client
    this.timeSinceLastPing = setTimeout(() => handleFailedPing(this),TIME_BETWEEN_PINGS + LATE_PING_GRACE_PD);
  }

  pongClient() {
    if (!this.enabled) {return}
    clearTimeout(this.timeSinceLastPing);
    this.failedPings = 0;
    this.sendMessage('',"PONG");
    this.catchTimeout();
    //console.log(`Client ${this.id} has pinged!`)
  }

  handleAck(messageId) {
    let messageObj = this.listOfMessages.filter((obj) => obj.messageId == messageId)[0];
    this.listOfMessages.splice(this.listOfMessages.indexOf(messageObj),1);
    messageObj = messageObj.messageObj;
    messageObj.complete();
    messageObj.cbOnComplete(messageObj.message);
    //console.log(`Client has acknowledged the message ${messageObj.message}`);
  }

  handleMessage(message) {
    message = message.toString();
    const requestCode = message.slice(0,REQ_CODE_LENGTH);
    const payload = message.slice(REQ_CODE_LENGTH+1);
    switch(requestCode) {
      case 'PING': this.pongClient(); break;
      case 'CLSE': this.client.close(1000, "CLIENT_REQ"); this.handleClose(); break;
      case 'NOID': this.sendSessId(); break;
      case 'HSID': this.handleOldId(payload); break;
      case 'ACKD': this.handleAck(payload); break;
      case 'RQPC': this.sendMessage(TIME_BETWEEN_PINGS-TIME_BETWEEN_MESSAGE_SEND_ATTEMPTS,'INPT'); this.sendMessage(REQ_CODE_LENGTH,'INCL'); break;
      case 'SVRQ': if (!("handleMessage" in this.handler)) {console.log(`WARNING: Handler for client ${this.id}
                    does not have the required handleMessage method, the client cannot communicate with it.`)} else {
                    this.handler.handleMessage(payload)}; break;
      default: console.log(`WARNING: Client ${this.id} has sent an invalid request code: ${requestCode}`);
    }
  }

  sendSessId() {
    console.log(`Client ${this.id} has connected!`)
    this.sendMessage(this.sessionId,'SNID');
  }

  handleOldId(id) {
    this.enabled = false;
    const correctSession = connLst.filter((ele) => ele.sessionId == id)[0].session;
    console.log(`Client ${correctSession.id} has reconnected!`)
    correctSession.onNewSocket(this.client);
  }

  handleClose() {
    if (!this.enabled) {return}
    clearTimeout(this.timeSinceLastPing);
    for (let message of this.listOfMessages) {message.messageObj.complete()}
    console.log(`Client ${this.id} has closed the connection`);
    if (!'handleClose' in this.handler) {console.log(`WARNING: Client ${this.id}'s handler does not have a handleClose function,
      its processes may still be running.`)} else {this.handler.handleClose()}
  }

  handleError(err) {
    if (!this.enabled) {return}
    this.handleClose();
    console.log(`WARNING: Client ${this.id} has had the following error: ${err}`)
  }

  sendMessage(data,code,callbackOnComplete=()=>0,callbackOnFail=()=>0) {
    const message = code + ' ' + data+'|'+this.messageId;
    const messageObj = new Message(message,this.client,callbackOnComplete,callbackOnFail);
    this.listOfMessages.push({messageId:this.messageId, messageObj:messageObj});
    this.messageId++;
  }

  sendData(data,code) {
    this.sendMessage(code+' '+data,'SVRS');
  }

}

class Message {
  constructor(message,socket,cbOnComplete,cbOnFail) {
    this.message = message;
    this.socket = socket;
    this.failCount = 0;
    this.completed = false;
    this.cbOnComplete = cbOnComplete;
    this.cbOnFail = cbOnFail;
    this.sendAttempt = setTimeout(() => this.trySendMessage(),0);
  }

  trySendMessage() {
    if (this.completed) {
      clearTimeout(this.sendAttempt);
      return;
    }
    if (this.failCount < MAX_MESSAGE_SEND_ATTEMPTS) {
      this.socket.send(this.message);
      this.sendAttempt = setTimeout(() => this.trySendMessage(), TIME_BETWEEN_MESSAGE_SEND_ATTEMPTS)
    } else {
      console.log(`WARNING: Message ${this.message} was unable to send`);
      this.complete();
      this.cbOnFail(this.message);
    }
    this.failCount++;
  }

  complete() {
    this.completed = true;
    clearTimeout(this.sendAttempt);
  }

}

//testStartServer();

exports.startServer = startServer;