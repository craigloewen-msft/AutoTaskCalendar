import zmq

class HelloRPC(object):
    '''pass the method a name, it replies "Hello name!"'''
    def hello(self, name):
        return "Hello, {0}!".format(name)

def main():
    context = zmq.Context()
    socket = context.socket(zmq.REP)
    socket.bind("tcp://*:4242")

    rpc = HelloRPC()

    while True:
        # Wait for next request from client
        print("Waiting on request")
        message = socket.recv_string()
        print("Received request: %s" % message)

        # Call the RPC method and get the result
        result = rpc.hello(message)

        # Send reply back to client
        socket.send_string(result)

if __name__ == "__main__":
    main()