#ifndef PID_v1_h
#define PID_v1_h
#define LIBRARY_VERSION	1.2.1

class PID
{
  public:
  #define AUTOMATIC	1
  #define MANUAL	0
  #define DIRECT  0
  #define REVERSE  1
  #define P_ON_M 0
  #define P_ON_E 1

  PID(double*, double*, double*, double, double, double, int, int);
  PID(double*, double*, double*, double, double, double, int);
  void SetMode(int mode);
  bool Compute();
  void SetOutputLimits(double, double);
  void SetTunings(double, double, double);
  void SetTunings(double, double, double, int);
  void SetControllerDirection(int);
  void SetSampleTime(int);
  double GetKp();
  double GetKi();
  double GetKd();
  int GetMode();
  int GetDirection();

  private:
  void Initialize();
  double dispKp;
  double dispKi;
  double dispKd;
  double kp;
  double ki;
  double kd;
  int controllerDirection;
  int pOn;
  double *myInput;
  double *myOutput;
  double *mySetpoint;
  unsigned long lastTime;
  double outputSum, lastInput;
  unsigned long SampleTime;
  double outMin, outMax;
  bool inAuto;
};
#endif