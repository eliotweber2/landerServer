
Anatomy of a transmission:
    Space
    Main code (4 letters):
        Interfaces directly with the socket API
        Tells the socket what to do with the request, including forwarding it to other parts of the program
    Space
    Secondary code(s):
        Optional
        Read by the part of the program that the request was forwarded to by the previous code
    Space
    Payload:
        The data of the transmission
    Vertical Bar:
	    Only if transmission is sent from the server
    Message ID:
	    Only if transmission is sent from the server
	    Used to acknowledge messages have been received

Examples:
    ACKD 1
    The client is acknowledging that the message with ID 1 has been received
    SNID 34qwegbgsdfrqtw43|1
    The server is sending a session ID to the client


MAIN CODES:

PING: Client has pinged the server
PONG: Server has ponged the client
SVRQ: Client is sending a request to the server
SVRS: Server is sending a response to the client
SNID: Server is sending a session ID to the user
NOID: Client does not have a session ID
HSID: Client has a session ID and is sending it
CLSE: Client wants to close the connection
INPT: Server is sending the desired time between pings
INCL: Server is sending the request code length
RQPC: Client is requesting the desired time between pings and the request code length
ACKD: Previous command has been received

SERVER CODES:
    LDRP: Server is sending the position of the lander
    GRND: Server is sending the position of the ground
    RSET: Server wants to reset

CLIENT CODES:
    RNFA: Client is requesting the next frame
    INIT: Client is requesting the initial data for the session

