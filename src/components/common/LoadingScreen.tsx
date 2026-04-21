import logo from '../../assets/logo.png';

interface Props {
  progress: number;
  isFadingOut: boolean;
}

export default function LoadingScreen({ progress, isFadingOut }: Props) {
  return (
    <div className={`loading-screen ${isFadingOut ? 'fade-out' : ''}`}>
      <img src={logo} alt="We Page Logo" className="loading-logo" />
      
      <div className="loading-progress-container">
        <div 
          className="loading-progress-bar" 
          style={{ width: `${progress * 100}%` }} 
        />
        <div className="loading-progress-shimmer" />
      </div>
      
      <div className="loading-text">
        Cargando experiencia...
      </div>
    </div>
  );
}
